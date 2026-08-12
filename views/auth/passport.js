const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const userStorage = require('./user-storage');

function getCallbackUrl() {
   if (process.env.GOOGLE_CALLBACK_URL) {
      return process.env.GOOGLE_CALLBACK_URL;
   }
   const base = process.env.APP_URL || 'http://localhost:3000';
   return `${base.replace(/\/$/, '')}/auth/google/callback`;
}

function isGoogleConfigured() {
   return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function configurePassport() {
   passport.serializeUser((user, done) => {
      done(null, user.id);
   });

   passport.deserializeUser((id, done) => {
      try {
         const user = userStorage.findById(id);
         done(null, user || false);
      } catch (error) {
         done(error);
      }
   });

   if (!isGoogleConfigured()) {
      console.warn('Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env');
      return;
   }

   passport.use(new GoogleStrategy({
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: getCallbackUrl()
   }, (accessToken, refreshToken, profile, done) => {
      try {
         const user = userStorage.findOrCreateFromGoogle(profile);
         done(null, user);
      } catch (error) {
         done(error);
      }
   }));
}

module.exports = {
   passport,
   configurePassport,
   isGoogleConfigured,
   getCallbackUrl
};
