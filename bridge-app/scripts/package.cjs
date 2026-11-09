'use strict';
require('./build-installers.cjs').main().catch(e=>{console.error(e);process.exit(1);});
