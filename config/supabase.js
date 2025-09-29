// backend/config/supabase.js
require('dotenv').config();  // ensure env vars are loaded

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase environment variables (URL and Key required)');
}

// Create Supabase client (server-side). Using the same client for admin ops,
// since SUPABASE_KEY is the service role key on the server.
const supabase = createClient(supabaseUrl, supabaseKey);
const supabaseAdmin = supabase;

module.exports = { supabase, supabaseAdmin };
