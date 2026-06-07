const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files from the root directory
app.use(express.static(__dirname));

// Fallback to index.html for single-page routing if needed
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`==================================================`);
    console.log(`   CivicAI Grievance Decision System Server        `);
    console.log(`==================================================`);
    console.log(`Server is running at: http://localhost:${PORT}`);
    console.log(`Press Ctrl+C to terminate server.`);
    console.log(`==================================================`);
});
