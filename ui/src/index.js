'use strict';

const express = require('express');
const path = require('path');

const app = express();

const PORT = process.env.PORT || 7337;

// serve static frontend
app.use(express.static(path.join(__dirname, '../public')));

app.listen(PORT, '127.0.0.1', () => {
  console.log(`local app server running at http://127.0.0.1:${PORT}`);
});