const puppeteer = require('puppeteer');
const fs = require('fs').promises;
require('dotenv').config();
const mongoURI = process.env.MONGO_URI;
const dbModule = require("./db.js");
dbModule.connectToMongoDB(mongoURI);
const config = require('./config.json');

let responses = [];
let usersEntries = [];
let count = 0;
let scrollInterval;

async function setupRequestInterceptor(searchQuery,page) {
  
  page.setRequestInterception(true);

  page.on('request', (request) => {
    request.continue();
  });

  page.on('response', async (response) => {
    const url = response.url();
  
    if (url.startsWith('https://twitter.com/i/api/graphql/Aj1nGkALq99Xg3XI0OZBtw/SearchTimeline?')) {
      const responseData = {
        url: url,
        status: response.status(),
        content: await response.text(),
      };
  
      try {
        responseData.parsedContent = JSON.parse(responseData.content);
      } catch (error) {
        console.error('Error parsing JSON:', error.message);
      }
  
      responses.push(responseData);
  
      if (responseData.parsedContent && responseData.parsedContent.data) {
        const entries = responseData.parsedContent.data.search_by_raw_query.search_timeline.timeline.instructions
          .filter(instruction => instruction.type === 'TimelineAddEntries')
          .map(instruction => instruction.entries)
          .flat();
        //this to remove the top and bottom cursor entries because they are not users 
        const filteredEntries = entries.filter(entry => !entry.entryId.startsWith('cursor-'));
        usersEntries = usersEntries.concat(...filteredEntries);
        count++;
        saveEntries(searchQuery, filteredEntries);
        if (count >= config.maxScrolls) {
            console.log('Reached 2 scrolls. Stopping scrolling.');
            clearInterval(scrollInterval);
  
          }
      }
    }
  });
}

async function navigateToSearchPage(searchQuery, page) {
  await page.goto(`https://twitter.com/search?q=${searchQuery}&f=user`);
}

async function saveEntriesToDB(searchQuery, entries) {
    try {
      const db = dbModule.getDb();
      const collectionName = searchQuery.replace(/\s+/g, '_'); // Replace spaces with underscores
      const collection = db.collection(collectionName);
  
      // Create or find the document using a unique identifier
      const identifier = { searchQuery: searchQuery };
      const existingDocument = await collection.findOne(identifier);
  
      if (existingDocument) {
        // If the document already exists, update it by pushing new entries
        await collection.updateOne(identifier, { $push: { entries: { $each: entries } } });
      } else {
        // If the document does not exist, create a new one
        await collection.insertOne({ ...identifier, entries: entries });
      }
  
      console.log(`${entries.length} Entries saved to MongoDB collection: ${collectionName}`);
    } catch (error) {
      console.error('Error saving entries to MongoDB:', error);
    }
  }

async function saveEntriesToFile(newEntries) {
    try {
      // Read existing file content
      const existingContent = await fs.readFile('usersEntries.json', 'utf-8');
      const existingEntries = JSON.parse(existingContent);
  
      // Find unique new entries by comparing with existing entries
      const uniqueNewEntries = newEntries.filter(newEntry => !existingEntries.some(existingEntry => existingEntry.entryId === newEntry.entryId));
  
      // Merge unique new entries with existing entries
      const updatedEntries = [...existingEntries, ...uniqueNewEntries];
  
      // Save the updated entries to the file
      const jsonContent = JSON.stringify(updatedEntries, null, 2);
      await fs.writeFile('usersEntries.json', jsonContent);
  
      console.log('Users entries saved to usersEntries.json');
    } catch (error) {
      console.error('Error saving file:', error);
    }
}


async function saveEntries(searchQuery,entries) {
  await saveEntriesToDB(searchQuery, entries);
}
async function main() {
  const browser = await puppeteer.launch({headless: config.headless});
  const page = await browser.newPage();
  //authentication cookie
  const authToken = process.env.TWITTER_AUTH_TOKEN;  
  if (!authToken) {
    console.error('Authentication token not found in environment variables.');
    await browser.close();
    return;
  }
  
  const cookie = {
    name: 'auth_token',
    value: authToken,
    domain: '.twitter.com',
    secure: true,
    path: '/',
  };
  
  await page.setCookie(cookie);


  const searchQuery = config.searchQuery;

  if (!searchQuery) {
    console.error('Error: Please provide a search query in the config file.');
    process.exit(1);
  }

  await navigateToSearchPage(searchQuery, page);
  await setupRequestInterceptor(searchQuery, page);

  scrollInterval = setInterval(async () => {
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
  }, config.scrollInterval);
}

main();