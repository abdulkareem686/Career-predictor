const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

function ensureFile() {
   if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
   }
   if (!fs.existsSync(USERS_FILE)) {
      fs.writeFileSync(USERS_FILE, JSON.stringify({ users: {} }, null, 2));
   }
}

function readStore() {
   ensureFile();
   try {
      return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
   } catch {
      return { users: {} };
   }
}

function writeStore(data) {
   ensureFile();
   fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
}

function sanitizeUser(user) {
   if (!user) return null;
   return {
      id: user.id,
      email: user.email,
      name: user.name,
      picture: user.picture || null,
      provider: user.provider,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt
   };
}

function findById(id) {
   const store = readStore();
   return sanitizeUser(store.users[id]) || null;
}

function findByEmail(email) {
   if (!email) return null;
   const store = readStore();
   const normalized = email.toLowerCase().trim();
   const user = Object.values(store.users).find(
      (u) => u.email && u.email.toLowerCase() === normalized
   );
   return sanitizeUser(user);
}

function findByGoogleId(googleId) {
   if (!googleId) return null;
   const store = readStore();
   const user = Object.values(store.users).find((u) => u.googleId === googleId);
   return sanitizeUser(user);
}

function findOrCreateFromGoogle(profile) {
   const store = readStore();
   const googleId = profile.id;
   const email = profile.emails?.[0]?.value?.toLowerCase().trim();
   const name = profile.displayName || profile.name?.givenName || 'User';
   const picture = profile.photos?.[0]?.value || null;

   let existing = Object.values(store.users).find((u) => u.googleId === googleId);
   if (!existing && email) {
      existing = Object.values(store.users).find(
         (u) => u.email && u.email.toLowerCase() === email
      );
   }

   const now = new Date().toISOString();

   if (existing) {
      store.users[existing.id] = {
         ...existing,
         googleId,
         email: email || existing.email,
         name,
         picture,
         provider: 'google',
         lastLoginAt: now,
         updatedAt: now
      };
      writeStore(store);
      return sanitizeUser(store.users[existing.id]);
   }

   const id = crypto.randomUUID();
   store.users[id] = {
      id,
      googleId,
      email,
      name,
      picture,
      provider: 'google',
      assessmentData: {},
      recommendations: null,
      careerProfile: null,
      createdAt: now,
      lastLoginAt: now,
      updatedAt: now
   };
   writeStore(store);
   return sanitizeUser(store.users[id]);
}

function updateUserProgress(userId, data) {
   const store = readStore();
   const user = store.users[userId];
   if (!user) return null;

   store.users[userId] = {
      ...user,
      ...data,
      updatedAt: new Date().toISOString()
   };
   writeStore(store);
   return sanitizeUser(store.users[userId]);
}

function getUserProgress(userId) {
   const store = readStore();
   const user = store.users[userId];
   if (!user) return null;
   return {
      assessmentData: user.assessmentData || {},
      recommendations: user.recommendations || null,
      careerProfile: user.careerProfile || null,
      studentData: user.studentData || null
   };
}

module.exports = {
   findById,
   findByEmail,
   findByGoogleId,
   findOrCreateFromGoogle,
   updateUserProgress,
   getUserProgress,
   sanitizeUser
};
