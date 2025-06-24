module.exports = {
    env: {
        browser: false,
        commonjs: true,
        es2021: true,
        node: true
    },
    extends: [
        'eslint:recommended'
    ],
    parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module'
    },
    rules: {
        // Code style
        'indent': ['error', 4],
        'linebreak-style': ['error', 'unix'],
        'quotes': ['error', 'single'],
        'semi': ['error', 'always'],
        
        // Best practices
        'no-unused-vars': ['error', { 'argsIgnorePattern': '^_' }],
        'no-console': 'off', // We use console for logging
        'prefer-const': 'error',
        'no-var': 'error',
        
        // Async/await
        'require-await': 'error',
        'no-return-await': 'error',
        
        // Error handling
        'no-throw-literal': 'error',
        'prefer-promise-reject-errors': 'error',
        
        // Security
        'no-eval': 'error',
        'no-implied-eval': 'error',
        'no-new-func': 'error',
        
        // Performance
        'no-loop-func': 'error',
        'no-constant-condition': ['error', { 'checkLoops': false }]
    },
    globals: {
        'process': 'readonly',
        'Buffer': 'readonly',
        '__dirname': 'readonly',
        '__filename': 'readonly',
        'module': 'readonly',
        'require': 'readonly',
        'exports': 'readonly',
        'global': 'readonly'
    }
};
