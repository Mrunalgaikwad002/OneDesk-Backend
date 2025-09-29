const express = require('express');
const multer = require('multer');
const { supabase } = require('../config/supabase');

const router = express.Router();

// Multer setup for file uploads (memory)
const upload = multer({ storage: multer.memoryStorage() });

// AUTH — Signup
router.post('/signup', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return res.status(400).json({ error: error.message });
    return res.json(data);
  } catch (error) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// AUTH — Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return res.status(400).json({ error: error.message });
    return res.json({ message: 'logged in successfully', data });
  } catch (error) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DATABASE — Create (demo table: users)
router.post('/add-user', async (req, res) => {
  try {
    const { name, number, age } = req.body;
    if (!name || !number || !age) {
      return res.status(400).json({ error: 'Name, number and age are required' });
    }

    const { data, error } = await supabase
      .from('users')
      .insert([{ name, number, age }])
      .select();

    if (error) return res.status(400).json({ error: error.message });
    return res.json(data);
  } catch (error) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DATABASE — Read (demo table: users)
router.get('/users', async (req, res) => {
  const { data, error } = await supabase.from('users').select('*');
  if (error) return res.status(400).json({ error: error.message });
  return res.json(data);
});

// STORAGE — Upload File (demo bucket: my-bucket, prefix uploads/)
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'Missing file' });

    const path = `uploads/${Date.now()}-${file.originalname}`;
    const { data, error } = await supabase
      .storage
      .from('my-bucket')
      .upload(path, file.buffer, { contentType: file.mimetype });

    if (error) return res.status(400).json({ error: error.message });
    return res.json({ path: data.path });
  } catch (error) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// STORAGE — List Files (prefix uploads)
router.get('/files', async (req, res) => {
  const { data, error } = await supabase.storage.from('my-bucket').list('uploads');
  if (error) return res.status(400).json({ error: error.message });
  return res.json(data);
});

// STORAGE — Delete File
router.delete('/files/:fileName', async (req, res) => {
  const { fileName } = req.params;
  const { data, error } = await supabase.storage.from('my-bucket').remove([`uploads/${fileName}`]);
  if (error) return res.status(400).json({ error: error.message });
  return res.json({ deleted: data });
});

module.exports = router;


