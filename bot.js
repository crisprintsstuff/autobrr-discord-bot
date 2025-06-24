const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, REST, Routes } = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Configuration
const config = {
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.DISCORD_CLIENT_ID,
    guildId: process.env.DISCORD_GUILD_ID, // Optional: for guild-specific commands
    autobrr: {
        baseUrl: process.env.AUTOBRR_BASE_URL || 'http://localhost:7474',
        apiKey: process.env.AUTOBRR_API_KEY,
        username: process.env.AUTOBRR_USERNAME,
        password: process.env.AUTOBRR_PASSWORD
    },
    allowedRoles: process.env.ALLOWED_ROLES ? process.env.ALLOWED_ROLES.split(',') : ['admin', 'moderator'],
    logLevel: process.env.LOG_LEVEL || 'info'
};

// Logger utility
class Logger {
    static log(level, message, error = null) {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
        
        console.log(logMessage);
        
        if (error) {
            console.error(error);
        }
        
        // Write to log file
        const logFile = path.join(__dirname, 'logs', `autobrr-bot-${new Date().toISOString().split('T')[0]}.log`);
        fs.appendFileSync(logFile, logMessage + '\n', { flag: 'a' });
    }
    
    static info(message) { this.log('info', message); }
    static warn(message) { this.log('warn', message); }
    static error(message, error) { this.log('error', message, error); }
    static debug(message) { 
        if (config.logLevel === 'debug') this.log('debug', message); 
    }
}

// Autobrr API client
class AutobrrAPI {
    constructor() {
        this.baseUrl = config.autobrr.baseUrl;
        this.apiKey = config.autobrr.apiKey;
        this.authToken = null;
        this.axios = axios.create({
            baseURL: this.baseUrl,
            timeout: 10000,
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        // Request interceptor for authentication
        this.axios.interceptors.request.use(async (config) => {
            if (this.authToken) {
                config.headers.Authorization = `Bearer ${this.authToken}`;
            } else if (this.apiKey) {
                config.headers['X-API-Token'] = this.apiKey;
            }
            return config;
        });
        
        // Response interceptor for error handling
        this.axios.interceptors.response.use(
            (response) => response,
            async (error) => {
                if (error.response?.status === 401) {
                    Logger.warn('Authentication failed, attempting to re-authenticate');
                    await this.authenticate();
                    return this.axios.request(error.config);
                }
                throw error;
            }
        );
    }
    
    async authenticate() {
        try {
            if (config.autobrr.username && config.autobrr.password) {
                const response = await this.axios.post('/api/auth/login', {
                    username: config.autobrr.username,
                    password: config.autobrr.password
                });
                
                this.authToken = response.data.token;
                Logger.info('Successfully authenticated with Autobrr API');
                return true;
            }
            return false;
        } catch (error) {
            Logger.error('Failed to authenticate with Autobrr API', error);
            throw new Error('Authentication failed');
        }
    }
    
    async getStatus() {
        try {
            const response = await this.axios.get('/api/healthz/liveness');
            return {
                status: 'online',
                version: response.data.version || 'unknown',
                uptime: response.data.uptime || 'unknown'
            };
        } catch (error) {
            Logger.error('Failed to get Autobrr status', error);
            throw new Error('Failed to retrieve system status');
        }
    }
    
    async getFilters() {
        try {
            const response = await this.axios.get('/api/filters');
            return response.data;
        } catch (error) {
            Logger.error('Failed to get filters', error);
            throw new Error('Failed to retrieve filters');
        }
    }
    
    async getFilter(id) {
        try {
            const response = await this.axios.get(`/api/filters/${id}`);
            return response.data;
        } catch (error) {
            Logger.error(`Failed to get filter ${id}`, error);
            throw new Error(`Failed to retrieve filter ${id}`);
        }
    }
    
    async getReleases(limit = 20) {
        try {
            const response = await this.axios.get(`/api/release?limit=${limit}&offset=0`);
            return response.data;
        } catch (error) {
            Logger.error('Failed to get releases', error);
            throw new Error('Failed to retrieve releases');
        }
    }
    
    async approveRelease(id) {
        try {
            const response = await this.axios.post(`/api/release/${id}/approve`);
            return response.data;
        } catch (error) {
            Logger.error(`Failed to approve release ${id}`, error);
            throw new Error(`Failed to approve release ${id}`);
        }
    }
    
    async rejectRelease(id) {
        try {
            const response = await this.axios.post(`/api/release/${id}/reject`);
            return response.data;
        } catch (error) {
            Logger.error(`Failed to reject release ${id}`, error);
            throw new Error(`Failed to reject release ${id}`);
        }
    }
    
    async getLogs(limit = 50) {
        try {
            const response = await this.axios.get(`/api/logs?limit=${limit}`);
            return response.data;
        } catch (error) {
            Logger.error('Failed to get logs', error);
            throw new Error('Failed to retrieve logs');
        }
    }
    
    async getSettings() {
        try {
            const response = await this.axios.get('/api/config');
            return response.data;
        } catch (error) {
            Logger.error('Failed to get settings', error);
            throw new Error('Failed to retrieve settings');
        }
    }
}

// Permission checker
function hasPermission(interaction) {
    if (interaction.user.id === interaction.guild?.ownerId) return true;
    
    const member = interaction.guild?.members.cache.get(interaction.user.id);
    if (!member) return false;
    
    // Check if user has administrator permission
    if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
    
    // Check if user has any of the allowed roles
    const hasAllowedRole = member.roles.cache.some(role => 
        config.allowedRoles.includes(role.name.toLowerCase())
    );
    
    return hasAllowedRole;
}

// Create logs directory
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

// Initialize Discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages
    ]
});

// Initialize Autobrr API client
const autobrrAPI = new AutobrrAPI();

// Slash commands
const commands = [
    new SlashCommandBuilder()
        .setName('status')
        .setDescription('Show Autobrr system status')
        .setDefaultMemberPermissions(PermissionFlagsBits.UseApplicationCommands),
    
    new SlashCommandBuilder()
        .setName('filters')
        .setDescription('Display all configured filters')
        .setDefaultMemberPermissions(PermissionFlagsBits.UseApplicationCommands),
    
    new SlashCommandBuilder()
        .setName('filter')
        .setDescription('Show specific filter details')
        .addIntegerOption(option =>
            option.setName('id')
                .setDescription('Filter ID')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.UseApplicationCommands),
    
    new SlashCommandBuilder()
        .setName('releases')
        .setDescription('Show recent releases')
        .addIntegerOption(option =>
            option.setName('limit')
                .setDescription('Number of releases to show (max 50)')
                .setMinValue(1)
                .setMaxValue(50))
        .setDefaultMemberPermissions(PermissionFlagsBits.UseApplicationCommands),
    
    new SlashCommandBuilder()
        .setName('approve')
        .setDescription('Approve a pending release')
        .addIntegerOption(option =>
            option.setName('id')
                .setDescription('Release ID')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
    
    new SlashCommandBuilder()
        .setName('reject')
        .setDescription('Reject a pending release')
        .addIntegerOption(option =>
            option.setName('id')
                .setDescription('Release ID')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
    
    new SlashCommandBuilder()
        .setName('logs')
        .setDescription('Display recent system logs')
        .addIntegerOption(option =>
            option.setName('limit')
                .setDescription('Number of log entries to show (max 100)')
                .setMinValue(1)
                .setMaxValue(100))
        .setDefaultMemberPermissions(PermissionFlagsBits.UseApplicationCommands),
    
    new SlashCommandBuilder()
        .setName('settings')
        .setDescription('View Autobrr settings')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
];

// Register slash commands
async function registerCommands() {
    try {
        const rest = new REST({ version: '10' }).setToken(config.token);
        
        Logger.info('Started refreshing application (/) commands.');
        
        if (config.guildId) {
            // Register guild-specific commands (faster for development)
            await rest.put(
                Routes.applicationGuildCommands(config.clientId, config.guildId),
                { body: commands }
            );
        } else {
            // Register global commands
            await rest.put(
                Routes.applicationCommands(config.clientId),
                { body: commands }
            );
        }
        
        Logger.info('Successfully reloaded application (/) commands.');
    } catch (error) {
        Logger.error('Failed to register commands', error);
    }
}

// Event handlers
client.once('ready', async () => {
    Logger.info(`Bot logged in as ${client.user.tag}!`);
    
    // Authenticate with Autobrr API
    try {
        await autobrrAPI.authenticate();
    } catch (error) {
        Logger.error('Failed to authenticate with Autobrr API on startup', error);
    }
    
    // Set bot status
    client.user.setActivity('Autobrr releases', { type: 'WATCHING' });
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    
    // Check permissions
    if (!hasPermission(interaction)) {
        await interaction.reply({
            content: '❌ You do not have permission to use this command.',
            ephemeral: true
        });
        return;
    }
    
    try {
        await interaction.deferReply();
        
        switch (interaction.commandName) {
            case 'status':
                await handleStatusCommand(interaction);
                break;
            case 'filters':
                await handleFiltersCommand(interaction);
                break;
            case 'filter':
                await handleFilterCommand(interaction);
                break;
            case 'releases':
                await handleReleasesCommand(interaction);
                break;
            case 'approve':
                await handleApproveCommand(interaction);
                break;
            case 'reject':
                await handleRejectCommand(interaction);
                break;
            case 'logs':
                await handleLogsCommand(interaction);
                break;
            case 'settings':
                await handleSettingsCommand(interaction);
                break;
            default:
                await interaction.editReply('❌ Unknown command.');
        }
    } catch (error) {
        Logger.error(`Error handling command ${interaction.commandName}`, error);
        
        const errorMessage = error.message.includes('Failed to') 
            ? error.message 
            : 'An unexpected error occurred while processing your request.';
        
        try {
            await interaction.editReply(`❌ ${errorMessage}`);
        } catch (editError) {
            Logger.error('Failed to edit reply with error message', editError);
        }
    }
});

// Command handlers
async function handleStatusCommand(interaction) {
    const status = await autobrrAPI.getStatus();
    
    const embed = new EmbedBuilder()
        .setTitle('🟢 Autobrr System Status')
        .setColor('#00ff00')
        .addFields([
            { name: 'Status', value: status.status, inline: true },
            { name: 'Version', value: status.version, inline: true },
            { name: 'Uptime', value: status.uptime, inline: true }
        ])
        .setTimestamp();
    
    await interaction.editReply({ embeds: [embed] });
}

async function handleFiltersCommand(interaction) {
    const filters = await autobrrAPI.getFilters();
    
    if (!filters || filters.length === 0) {
        await interaction.editReply('📝 No filters configured.');
        return;
    }
    
    const embed = new EmbedBuilder()
        .setTitle('📋 Configured Filters')
        .setColor('#0099ff')
        .setTimestamp();
    
    // Limit to first 25 filters to avoid embed limits
    const displayFilters = filters.slice(0, 25);
    
    for (const filter of displayFilters) {
        embed.addFields([{
            name: `${filter.name} (ID: ${filter.id})`,
            value: `Enabled: ${filter.enabled ? '✅' : '❌'} | Priority: ${filter.priority}`,
            inline: false
        }]);
    }
    
    if (filters.length > 25) {
        embed.setFooter({ text: `Showing 25 of ${filters.length} filters` });
    }
    
    await interaction.editReply({ embeds: [embed] });
}

async function handleFilterCommand(interaction) {
    const filterId = interaction.options.getInteger('id');
    const filter = await autobrrAPI.getFilter(filterId);
    
    const embed = new EmbedBuilder()
        .setTitle(`🔍 Filter: ${filter.name}`)
        .setColor('#0099ff')
        .addFields([
            { name: 'ID', value: filter.id.toString(), inline: true },
            { name: 'Enabled', value: filter.enabled ? '✅' : '❌', inline: true },
            { name: 'Priority', value: filter.priority.toString(), inline: true },
            { name: 'Match Releases', value: filter.match_releases || 'N/A', inline: true },
            { name: 'Except Releases', value: filter.except_releases || 'N/A', inline: true },
            { name: 'Use Regex', value: filter.use_regex ? '✅' : '❌', inline: true }
        ])
        .setTimestamp();
    
    if (filter.indexers && filter.indexers.length > 0) {
        embed.addFields([{
            name: 'Indexers',
            value: filter.indexers.join(', '),
            inline: false
        }]);
    }
    
    await interaction.editReply({ embeds: [embed] });
}

async function handleReleasesCommand(interaction) {
    const limit = interaction.options.getInteger('limit') || 20;
    const releases = await autobrrAPI.getReleases(limit);
    
    if (!releases || releases.length === 0) {
        await interaction.editReply('📦 No recent releases found.');
        return;
    }
    
    const embed = new EmbedBuilder()
        .setTitle('📦 Recent Releases')
        .setColor('#ff9900')
        .setTimestamp();
    
    for (const release of releases.slice(0, 10)) { // Limit to 10 for embed limits
        const status = release.status || 'Unknown';
        const statusEmoji = status === 'APPROVED' ? '✅' : status === 'REJECTED' ? '❌' : '⏳';
        
        embed.addFields([{
            name: `${release.name} (ID: ${release.id})`,
            value: `${statusEmoji} ${status} | Size: ${release.size || 'Unknown'} | Indexer: ${release.indexer || 'Unknown'}`,
            inline: false
        }]);
    }
    
    if (releases.length > 10) {
        embed.setFooter({ text: `Showing 10 of ${releases.length} releases` });
    }
    
    await interaction.editReply({ embeds: [embed] });
}

async function handleApproveCommand(interaction) {
    const releaseId = interaction.options.getInteger('id');
    
    try {
        await autobrrAPI.approveRelease(releaseId);
        
        const embed = new EmbedBuilder()
            .setTitle('✅ Release Approved')
            .setDescription(`Release ID ${releaseId} has been approved successfully.`)
            .setColor('#00ff00')
            .setTimestamp();
        
        await interaction.editReply({ embeds: [embed] });
        Logger.info(`Release ${releaseId} approved by ${interaction.user.tag}`);
    } catch (error) {
        throw new Error(`Failed to approve release ${releaseId}: ${error.message}`);
    }
}

async function handleRejectCommand(interaction) {
    const releaseId = interaction.options.getInteger('id');
    
    try {
        await autobrrAPI.rejectRelease(releaseId);
        
        const embed = new EmbedBuilder()
            .setTitle('❌ Release Rejected')
            .setDescription(`Release ID ${releaseId} has been rejected successfully.`)
            .setColor('#ff0000')
            .setTimestamp();
        
        await interaction.editReply({ embeds: [embed] });
        Logger.info(`Release ${releaseId} rejected by ${interaction.user.tag}`);
    } catch (error) {
        throw new Error(`Failed to reject release ${releaseId}: ${error.message}`);
    }
}

async function handleLogsCommand(interaction) {
    const limit = interaction.options.getInteger('limit') || 50;
    const logs = await autobrrAPI.getLogs(limit);
    
    if (!logs || logs.length === 0) {
        await interaction.editReply('📄 No recent logs found.');
        return;
    }
    
    // Format logs for display
    let logText = '```\n';
    const displayLogs = logs.slice(0, 20); // Limit for message size
    
    for (const log of displayLogs) {
        const timestamp = new Date(log.timestamp).toLocaleString();
        logText += `[${timestamp}] ${log.level}: ${log.message}\n`;
    }
    
    logText += '```';
    
    // If log text is too long, truncate it
    if (logText.length > 1900) {
        logText = logText.substring(0, 1900) + '...\n```';
    }
    
    const embed = new EmbedBuilder()
        .setTitle('📄 Recent System Logs')
        .setDescription(logText)
        .setColor('#666666')
        .setTimestamp();
    
    if (logs.length > 20) {
        embed.setFooter({ text: `Showing 20 of ${logs.length} log entries` });
    }
    
    await interaction.editReply({ embeds: [embed] });
}

async function handleSettingsCommand(interaction) {
    const settings = await autobrrAPI.getSettings();
    
    const embed = new EmbedBuilder()
        .setTitle('⚙️ Autobrr Settings')
        .setColor('#9932cc')
        .setTimestamp();
    
    // Display key settings (sanitized)
    if (settings.host) {
        embed.addFields([{ name: 'Host', value: settings.host, inline: true }]);
    }
    if (settings.port) {
        embed.addFields([{ name: 'Port', value: settings.port.toString(), inline: true }]);
    }
    if (settings.log_level) {
        embed.addFields([{ name: 'Log Level', value: settings.log_level, inline: true }]);
    }
    
    // Don't display sensitive information like API keys or passwords
    embed.setFooter({ text: 'Sensitive information hidden for security' });
    
    await interaction.editReply({ embeds: [embed] });
}

// Error handling
process.on('unhandledRejection', (error) => {
    Logger.error('Unhandled promise rejection', error);
});

process.on('uncaughtException', (error) => {
    Logger.error('Uncaught exception', error);
    process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', async () => {
    Logger.info('Received SIGINT, shutting down gracefully...');
    client.destroy();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    Logger.info('Received SIGTERM, shutting down gracefully...');
    client.destroy();
    process.exit(0);
});

// Start the bot
async function start() {
    try {
        // Validate configuration
        if (!config.token) {
            throw new Error('DISCORD_TOKEN environment variable is required');
        }
        if (!config.clientId) {
            throw new Error('DISCORD_CLIENT_ID environment variable is required');
        }
        if (!config.autobrr.baseUrl) {
            throw new Error('AUTOBRR_BASE_URL environment variable is required');
        }
        if (!config.autobrr.apiKey && (!config.autobrr.username || !config.autobrr.password)) {
            throw new Error('Either AUTOBRR_API_KEY or AUTOBRR_USERNAME/AUTOBRR_PASSWORD is required');
        }
        
        Logger.info('Starting Autobrr Discord Bot...');
        
        // Register commands
        await registerCommands();
        
        // Login to Discord
        await client.login(config.token);
        
    } catch (error) {
        Logger.error('Failed to start bot', error);
        process.exit(1);
    }
}

// Export for testing
module.exports = { client, autobrrAPI, Logger };

// Start the bot if this file is run directly
if (require.main === module) {
    start();
}