'use strict';
// Rebuild current-version packages; older release files remain untouched.
require('./build-installers.cjs').main().catch(e=>{console.error(e);process.exit(1);});
