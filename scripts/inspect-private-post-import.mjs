// Local read-only planning only: no payload files and no network operations.
import {loadPrivatePosts,privateImportSummary} from './lib/private-post-import.mjs';
try {
  if(process.argv.length!==2)throw Error();
  const posts=await loadPrivatePosts(process.cwd());
  console.log(JSON.stringify({status:'ready',...privateImportSummary(posts)}));
} catch(error) {
  console.error(JSON.stringify({status:'blocked',code:/^PRIVATE_IMPORT_E_[A-Z_]+$/u.test(error.safeCode??'')?error.safeCode:'PRIVATE_IMPORT_E_INPUT'}));
  process.exitCode=1;
}
