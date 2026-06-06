const fs = require('fs');
const text = fs.readFileSync('C:\\Users\\PC\\.gemini\\antigravity\\brain\\f1c4c2c5-eb55-47ac-a63a-96316a0bf2ed\\.system_generated\\steps\\2931\\content.md', 'utf8');
const urls = text.match(/https:\/\/[^"'\s]+/g);
if(urls) {
    const uniq = [...new Set(urls)].filter(u => u.includes('scribdassets') || u.includes('jsonp') || u.includes('json'));
    console.log(uniq.join('\n'));
}
