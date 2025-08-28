const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, 'logs');

async function ensureLogsDirectory() {
    try {
        await fs.access(logsDir);
    } catch (error) {
        await fs.mkdir(logsDir, { recursive: true });
    }
}

// Logger class
class Logger {
    constructor() {
        this.logFile = path.join(logsDir, 'app_logs.txt');
    }

    async log(type, title, description = '', metadata = {}) {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            type,
            title,
            description,
            metadata
        };

        const logLine = `[${timestamp}] [${type.toUpperCase()}] ${title}${description ? ` - ${description}` : ''}\n`;
        const detailedLog = `${JSON.stringify(logEntry, null, 2)}\n${'='.repeat(50)}\n`;

        try {
            // Append to main log file
            await fs.appendFile(this.logFile, logLine);
            
            // Also create separate files for each event type
            const typeFile = path.join(logsDir, `${type}_logs.txt`);
            await fs.appendFile(typeFile, detailedLog);
            
            console.log(`Logged ${type}: ${title}`);
            return true;
        } catch (error) {
            console.error('Failed to write log:', error);
            return false;
        }
    }
}

const logger = new Logger();

// API Routes

// Generic logging endpoint
app.post('/api/log', async (req, res) => {
    try {
        const { type, title, description = '', metadata = {} } = req.body;

        // Validate required fields
        if (!type || !title) {
            return res.status(400).json({
                success: false,
                error: 'Type and title are required fields'
            });
        }

        // Validate event type
        const allowedTypes = ['api-failed', 'log', 'error'];
        if (!allowedTypes.includes(type)) {
            return res.status(400).json({
                success: false,
                error: `Invalid event type. Allowed types: ${allowedTypes.join(', ')}`
            });
        }

        const success = await logger.log(type, title, description, {
            ...metadata,
            userAgent: req.headers['user-agent'],
            ip: req.ip,
            source: 'react-native-app'
        });

        if (success) {
            res.json({
                success: true,
                message: 'Log entry created successfully',
                timestamp: new Date().toISOString()
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Failed to write log entry'
            });
        }
    } catch (error) {
        console.error('Error in /api/log:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

// Specific event endpoints for convenience
app.post('/api/log/api-failed', async (req, res) => {
    const { title, description, metadata } = req.body;
    req.body = { type: 'api-failed', title, description, metadata };
    return app._router.handle(req, res); // Redirect to main log handler
});

app.post('/api/log/error', async (req, res) => {
    const { title, description, metadata } = req.body;
    req.body = { type: 'error', title, description, metadata };
    return app._router.handle(req, res); // Redirect to main log handler
});

app.post('/api/log/info', async (req, res) => {
    const { title, description, metadata } = req.body;
    req.body = { type: 'log', title, description, metadata };
    return app._router.handle(req, res); // Redirect to main log handler
});

// Get logs endpoint (optional - for viewing logs)
app.get('/api/logs', async (req, res) => {
    try {
        const { type, limit = 100 } = req.query;
        
        let filename = 'app_logs.txt';
        if (type && ['api-failed', 'log', 'error'].includes(type)) {
            filename = `${type}_logs.txt`;
        }
        
        const filePath = path.join(logsDir, filename);
        
        try {
            const data = await fs.readFile(filePath, 'utf8');
            const lines = data.split('\n').filter(line => line.trim());
            const recentLines = lines.slice(-limit);
            
            res.json({
                success: true,
                logs: recentLines,
                count: recentLines.length,
                file: filename
            });
        } catch (fileError) {
            res.json({
                success: true,
                logs: [],
                count: 0,
                message: 'No logs found'
            });
        }
    } catch (error) {
        console.error('Error reading logs:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to read logs'
        });
    }
});

// Clear logs endpoint (optional)
app.delete('/api/logs', async (req, res) => {
    try {
        const { type } = req.query;
        
        if (type && ['api-failed', 'log', 'error'].includes(type)) {
            const filePath = path.join(logsDir, `${type}_logs.txt`);
            await fs.writeFile(filePath, '');
            res.json({ success: true, message: `${type} logs cleared` });
        } else {
            // Clear all logs
            const files = ['app_logs.txt', 'api-failed_logs.txt', 'log_logs.txt', 'error_logs.txt'];
            for (const file of files) {
                try {
                    await fs.writeFile(path.join(logsDir, file), '');
                } catch (error) {
                    // File might not exist, continue
                }
            }
            res.json({ success: true, message: 'All logs cleared' });
        }
    } catch (error) {
        console.error('Error clearing logs:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to clear logs'
        });
    }
});

app.get('/logs', async (req, res) => {
    try {
        const { type, limit = 50 } = req.query;
        
        // Get all log types
        const logTypes = ['all', 'api-failed', 'log', 'error'];
        let logs = [];
        let selectedType = type || 'all';
        
        if (selectedType === 'all') {
            // Read from main log file and parse entries
            try {
                const data = await fs.readFile(path.join(logsDir, 'app_logs.txt'), 'utf8');
                logs = data.split('\n')
                    .filter(line => line.trim())
                    .slice(-limit)
                    .reverse(); // Show newest first
            } catch (error) {
                logs = ['No logs found'];
            }
        } else {
            // Read from specific log type file
            try {
                const data = await fs.readFile(path.join(logsDir, `${selectedType}_logs.txt`), 'utf8');
                const entries = data.split('='.repeat(50))
                    .filter(entry => entry.trim())
                    .slice(-limit)
                    .reverse(); // Show newest first
                
                logs = entries.map(entry => {
                    try {
                        const jsonMatch = entry.match(/\{[\s\S]*\}/);
                        if (jsonMatch) {
                            return JSON.parse(jsonMatch[0]);
                        }
                        return entry.trim();
                    } catch (e) {
                        return entry.trim();
                    }
                });
            } catch (error) {
                logs = ['No logs found for this type'];
            }
        }

        const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Logging Dashboard</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            border-radius: 15px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
            overflow: hidden;
        }
        
        .header {
            background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
            color: white;
            padding: 30px;
            text-align: center;
        }
        
        .header h1 {
            font-size: 2.5em;
            margin-bottom: 10px;
            text-shadow: 0 2px 4px rgba(0,0,0,0.3);
        }
        
        .header p {
            font-size: 1.1em;
            opacity: 0.9;
        }
        
        .controls {
            padding: 25px;
            background: #f8f9fa;
            border-bottom: 1px solid #e9ecef;
        }
        
        .control-group {
            display: flex;
            gap: 15px;
            align-items: center;
            flex-wrap: wrap;
        }
        
        .control-group label {
            font-weight: 600;
            color: #495057;
        }
        
        select, button {
            padding: 10px 15px;
            border: 2px solid #dee2e6;
            border-radius: 8px;
            font-size: 14px;
            transition: all 0.3s ease;
        }
        
        select:focus, button:focus {
            outline: none;
            border-color: #4facfe;
            box-shadow: 0 0 0 3px rgba(79, 172, 254, 0.2);
        }
        
        button {
            background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
            color: white;
            border: none;
            cursor: pointer;
            font-weight: 600;
        }
        
        button:hover {
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(79, 172, 254, 0.4);
        }
        
        .stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            padding: 25px;
            background: #f8f9fa;
        }
        
        .stat-card {
            background: white;
            padding: 20px;
            border-radius: 10px;
            text-align: center;
            box-shadow: 0 5px 15px rgba(0,0,0,0.08);
            border: 2px solid transparent;
            transition: all 0.3s ease;
        }
        
        .stat-card:hover {
            transform: translateY(-5px);
            border-color: #4facfe;
        }
        
        .stat-number {
            font-size: 2em;
            font-weight: bold;
            color: #4facfe;
        }
        
        .stat-label {
            color: #6c757d;
            font-weight: 600;
            margin-top: 5px;
        }
        
        .logs-container {
            padding: 25px;
            max-height: 600px;
            overflow-y: auto;
        }
        
        .log-entry {
            background: #f8f9fa;
            border: 1px solid #e9ecef;
            border-radius: 10px;
            padding: 20px;
            margin-bottom: 15px;
            transition: all 0.3s ease;
            position: relative;
        }
        
        .log-entry:hover {
            transform: translateX(5px);
            box-shadow: 0 5px 15px rgba(0,0,0,0.1);
        }
        
        .log-entry.error {
            border-left: 5px solid #dc3545;
            background: #fff5f5;
        }
        
        .log-entry.api-failed {
            border-left: 5px solid #fd7e14;
            background: #fff8f0;
        }
        
        .log-entry.log {
            border-left: 5px solid #28a745;
            background: #f0fff4;
        }
        
        .log-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
        }
        
        .log-type {
            background: #6c757d;
            color: white;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
        }
        
        .log-type.error { background: #dc3545; }
        .log-type.api-failed { background: #fd7e14; }
        .log-type.log { background: #28a745; }
        
        .log-timestamp {
            color: #6c757d;
            font-size: 12px;
            font-family: 'Courier New', monospace;
        }
        
        .log-title {
            font-size: 1.2em;
            font-weight: 600;
            color: #212529;
            margin-bottom: 8px;
        }
        
        .log-description {
            color: #6c757d;
            line-height: 1.4;
            margin-bottom: 10px;
        }
        
        .log-metadata {
            background: #e9ecef;
            padding: 10px;
            border-radius: 5px;
            font-family: 'Courier New', monospace;
            font-size: 12px;
            color: #495057;
            max-height: 150px;
            overflow-y: auto;
        }
        
        .empty-state {
            text-align: center;
            padding: 50px;
            color: #6c757d;
        }
        
        .empty-state i {
            font-size: 4em;
            margin-bottom: 20px;
            opacity: 0.3;
        }
        
        @media (max-width: 768px) {
            .control-group {
                flex-direction: column;
                align-items: stretch;
            }
            
            .stats {
                grid-template-columns: 1fr;
            }
            
            .log-header {
                flex-direction: column;
                align-items: flex-start;
                gap: 10px;
            }
        }
        
        .refresh-btn {
            position: fixed;
            bottom: 30px;
            right: 30px;
            width: 60px;
            height: 60px;
            border-radius: 50%;
            background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
            color: white;
            border: none;
            font-size: 20px;
            cursor: pointer;
            box-shadow: 0 5px 20px rgba(79, 172, 254, 0.4);
            transition: all 0.3s ease;
        }
        
        .refresh-btn:hover {
            transform: scale(1.1);
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📊 Nogger</h1>
            <p>Real-time monitoring of your React Native app logs</p>
        </div>
        
        <div class="controls">
            <div class="control-group">
                <label for="logType">Filter by type:</label>
                <select id="logType" onchange="filterLogs()">
                    <option value="all" ${selectedType === 'all' ? 'selected' : ''}>All Logs</option>
                    <option value="log" ${selectedType === 'log' ? 'selected' : ''}>Info Logs</option>
                    <option value="error" ${selectedType === 'error' ? 'selected' : ''}>Error Logs</option>
                    <option value="api-failed" ${selectedType === 'api-failed' ? 'selected' : ''}>API Failed</option>
                </select>
                
                <label for="limitSelect">Show:</label>
                <select id="limitSelect" onchange="filterLogs()">
                    <option value="25" ${limit == 25 ? 'selected' : ''}>25 entries</option>
                    <option value="50" ${limit == 50 ? 'selected' : ''}>50 entries</option>
                    <option value="100" ${limit == 100 ? 'selected' : ''}>100 entries</option>
                    <option value="200" ${limit == 200 ? 'selected' : ''}>200 entries</option>
                </select>
                
                <button onclick="clearLogs()">🗑️ Clear Logs</button>
                <button onclick="location.reload()">🔄 Refresh</button>
            </div>
        </div>
        
        <div class="logs-container">
            ${logs.length === 0 || (logs.length === 1 && logs[0] === 'No logs found') ? `
                <div class="empty-state">
                    <div style="font-size: 4em; margin-bottom: 20px; opacity: 0.3;">📝</div>
                    <h3>No logs found</h3>
                    <p>Logs will appear here when your React Native app sends events</p>
                </div>
            ` : logs.map(log => {
                if (typeof log === 'string') {
                    // Simple log format
                    const match = log.match(/\\[(.+?)\\] \\[(.+?)\\] (.+?)(?:\\s-\\s(.+))?$/);
                    if (match) {
                        const [, timestamp, type, title, description] = match;
                        return `
                            <div class="log-entry ${type.toLowerCase()}">
                                <div class="log-header">
                                    <span class="log-type ${type.toLowerCase()}">${type}</span>
                                    <span class="log-timestamp">${new Date(timestamp).toLocaleString()}</span>
                                </div>
                                <div class="log-title">${title}</div>
                                ${description ? `<div class="log-description">${description}</div>` : ''}
                            </div>
                        `;
                    }
                    return `
                        <div class="log-entry">
                            <div class="log-title">${log}</div>
                        </div>
                    `;
                } else {
                    // Detailed log format (JSON)
                    return `
                        <div class="log-entry ${log.type}">
                            <div class="log-header">
                                <span class="log-type ${log.type}">${log.type}</span>
                                <span class="log-timestamp">${new Date(log.timestamp).toLocaleString()}</span>
                            </div>
                            <div class="log-title">${log.title}</div>
                            ${log.description ? `<div class="log-description">${log.description}</div>` : ''}
                            ${Object.keys(log.metadata).length > 0 ? `
                                <div class="log-metadata">
                                    <strong>Metadata:</strong><br>
                                    ${JSON.stringify(log.metadata, null, 2)}
                                </div>
                            ` : ''}
                        </div>
                    `;
                }
            }).join('')}
        </div>
    </div>
    
    <script>
        function filterLogs() {
            const type = document.getElementById('logType').value;
            const limit = document.getElementById('limitSelect').value;
            const url = new URL(window.location);
            url.searchParams.set('type', type);
            url.searchParams.set('limit', limit);
            window.location.href = url.toString();
        }
        
        async function clearLogs() {
            if (confirm('Are you sure you want to clear all logs?')) {
                try {
                    const response = await fetch('/api/logs', { method: 'DELETE' });
                    const result = await response.json();
                    if (result.success) {
                        alert('Logs cleared successfully');
                        location.reload();
                    } else {
                        alert('Failed to clear logs: ' + result.error);
                    }
                } catch (error) {
                    alert('Error clearing logs: ' + error.message);
                }
            }
        }
        
        // Auto-refresh every 30 seconds
        setInterval(() => {
            const refreshBtn = document.querySelector('.refresh-btn');
            if (refreshBtn) {
                refreshBtn.style.animation = 'pulse 0.5s ease';
                setTimeout(() => {
                    refreshBtn.style.animation = '';
                }, 500);
            }
        }, 30000);
    </script>
    
    <style>
        @keyframes pulse {
            0% { transform: scale(1); }
            50% { transform: scale(1.2); }
            100% { transform: scale(1); }
        }
    </style>
</body>
</html>
        `;
        
        res.send(html);
    } catch (error) {
        console.error('Error generating logs page:', error);
        res.status(500).send('<h1>Error loading logs</h1><p>' + error.message + '</p>');
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        message: 'Logging API is running',
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    });
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    res.status(500).json({
        success: false,
        error: 'Internal server error'
    });
});

// Initialize and start server
async function startServer() {
    try {
        await ensureLogsDirectory();
        console.log('Logs directory ready');
        
        app.listen(PORT, () => {
            console.log(`\n🚀 Logging API Server running on port ${PORT}`);
            console.log(`📁 Logs are saved in: ${logsDir}`);
            console.log('\n📋 Available endpoints:');
            console.log(`   POST /api/log - Generic logging endpoint`);
            console.log(`   POST /api/log/api-failed - API failure logs`);
            console.log(`   POST /api/log/error - Error logs`);
            console.log(`   POST /api/log/info - Info logs`);
            console.log(`   GET /api/logs - View logs`);
            console.log(`   GET /api/health - Health check`);
            console.log(`   DELETE /api/logs - Clear logs\n`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

startServer();