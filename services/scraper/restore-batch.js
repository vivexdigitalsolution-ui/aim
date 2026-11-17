'use strict'

/**
 * restore-batch.js — combines ALL of today's batches (Japan date) into one: the newest batch keeps every car that is still valid
 * (open for bidding, auction tomorrow or later, passes the hard rules), up to 5 per model and 50 in all; the other batches of today are removed.
 * offer.js does this by itself after every run; use this only to clean up by hand.
 *
 *   node restore-batch.js --dry     show what the combined batch would be
 *   node restore-batch.js           do it
 */

const { mergeToday } = require('./lib/mergeToday')
mergeToday({ dry: process.argv.includes('--dry') }).catch((e) => { console.error(e.message); process.exit(1) })
