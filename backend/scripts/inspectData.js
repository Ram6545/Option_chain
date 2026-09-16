const h = require('../services/historicalReplayService');
(async () => {
  try {
    const fs = require('fs');
    ['console.error(\'Fetch', 'console.log(\'Count', '{'].forEach(f => {
      if (fs.existsSync(f)) {
        fs.unlinkSync(f);
        console.log('Removed scratch file:', f);
      }
    });
  } catch (e) {
    console.error('Error:', e);
  }
  process.exit(0);
})();
