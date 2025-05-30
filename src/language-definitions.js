// Language definitions for the Meet Extension
const LANGUAGE_DEFINITIONS = {
    ja: {
        // Ping types
        pings: {
            question: '疑問',
            onMyWay: '任せて',
            danger: '撤退',
            assist: '助けて',
            goodJob: 'いい感じ',
            finishHim: 'トドメだ',
            needInfo: '情報が必要',
            changePlan: '作戦変更'
        },
        // UI text
        ui: {
            everyone: 'みんなに',
            individual: '個別に',
            noParticipants: '参加者がいません',
            languageSelector: '言語',
            signIn: 'サインイン',
            signOut: 'サインアウト',
            signedInAs: 'としてサインイン中'
        }
    },
    en: {
        // Ping types
        pings: {
            question: 'Question',
            onMyWay: 'On it',
            danger: 'Retreat',
            assist: 'Help',
            goodJob: 'Good job',
            finishHim: 'Finish it',
            needInfo: 'Need info',
            changePlan: 'Change plan'
        },
        // UI text
        ui: {
            everyone: 'Everyone',
            individual: 'Individual',
            noParticipants: 'No participants',
            languageSelector: 'Language',
            signIn: 'Sign In',
            signOut: 'Sign Out',
            signedInAs: 'Signed in as'
        }
    }
};

// Language utility functions
const LanguageManager = {
    currentLanguage: 'ja',
    
    async init() {
        try {
            const result = await chrome.storage.sync.get(['language']);
            this.currentLanguage = result.language || 'ja';
        } catch (error) {
            console.log('Language initialization failed, using default:', error);
            this.currentLanguage = 'ja';
        }
    },
    
    async setLanguage(language) {
        this.currentLanguage = language;
        try {
            await chrome.storage.sync.set({ language });
        } catch (error) {
            console.error('Failed to save language preference:', error);
        }
    },
    
    getText(category, key) {
        const langDef = LANGUAGE_DEFINITIONS[this.currentLanguage];
        if (!langDef || !langDef[category] || !langDef[category][key]) {
            // Fallback to Japanese
            return LANGUAGE_DEFINITIONS.ja[category]?.[key] || key;
        }
        return langDef[category][key];
    },
    
    getPingLabel(pingType) {
        return this.getText('pings', pingType);
    },
    
    getUIText(key) {
        return this.getText('ui', key);
    },
    
    getSupportedLanguages() {
        return [
            { code: 'ja', name: '日本語', flag: '🇯🇵' },
            { code: 'en', name: 'English', flag: '🇺🇸' }
        ];
    }
};

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { LANGUAGE_DEFINITIONS, LanguageManager };
}