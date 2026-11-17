'use strict'

/**
 * lib/db.js — Supabase client for the Auction project (service role: bypasses RLS, so keep it in this scraper's .env only).
 */

require('dotenv').config()

const { createClient } = require('@supabase/supabase-js')

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_KEY

if (!url || !key) {
  console.error('[DB] Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env')
  process.exit(1)
}

module.exports = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
