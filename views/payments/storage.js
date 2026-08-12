const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const PAYMENTS_FILE = path.join(DATA_DIR, 'payments.json');

function ensureFile() {
   if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
   }
   if (!fs.existsSync(PAYMENTS_FILE)) {
      fs.writeFileSync(PAYMENTS_FILE, JSON.stringify({ customers: {} }, null, 2));
   }
}

function readStore() {
   ensureFile();
   try {
      const raw = fs.readFileSync(PAYMENTS_FILE, 'utf8');
      return JSON.parse(raw);
   } catch {
      return { customers: {} };
   }
}

function writeStore(data) {
   ensureFile();
   fs.writeFileSync(PAYMENTS_FILE, JSON.stringify(data, null, 2));
}

function getCustomerRecord(customerId) {
   const store = readStore();
   return store.customers[customerId] || null;
}

function getCustomerBySessionId(sessionId) {
   const store = readStore();
   return Object.values(store.customers).find((c) => c.sessionId === sessionId) || null;
}

function upsertCustomer(customerId, updates) {
   const store = readStore();
   const existing = store.customers[customerId] || {
      customerId,
      createdAt: new Date().toISOString()
   };

   store.customers[customerId] = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString()
   };

   writeStore(store);
   return store.customers[customerId];
}

function recordPaymentEvent(event) {
   const store = readStore();
   if (!store.events) store.events = [];
   store.events.push({
      ...event,
      recordedAt: new Date().toISOString()
   });
   if (store.events.length > 500) {
      store.events = store.events.slice(-500);
   }
   writeStore(store);
}

function getCustomerByEmail(email) {
   if (!email) return null;
   const store = readStore();
   const normalized = email.toLowerCase().trim();
   return Object.values(store.customers).find(
      (c) => c.email && c.email.toLowerCase() === normalized
   ) || null;
}

module.exports = {
   getCustomerRecord,
   getCustomerBySessionId,
   getCustomerByEmail,
   upsertCustomer,
   recordPaymentEvent
};
