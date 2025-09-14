// supabaseClient.js
// Usage: const supabase = require('./supabaseClient');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fhpxmawamoyfbrpmknrg.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZocHhtYXdhbW95ZmJycG1rbnJnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc3ODUxODYsImV4cCI6MjA3MzM2MTE4Nn0.K269CRlr6IhVyp7zezB4Iwuea2c3XweYckpcEx5CfD8';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

module.exports = supabase;
