// Shared by the test files: never swallow an error, never hang silently.
// - An unhandled rejection is printed and makes the process exit non-zero, even
//   if the file later calls process.exit(0). (ERR_MODULE_NOT_FOUND is expected:
//   app.js imports lib/pdf.min.mjs, which jsdom can't resolve; PDF pages are not
//   rendered in these tests.)
// - A watchdog ends the run with a clear message if it takes longer than `ms`.
//   It is unref()'d, so it never delays a normal exit; it only fires while
//   something (e.g. the auto-lock interval) is keeping the process alive.
module.exports = function guard(ms){
  ms = ms || 120000;
  let failed = false;
  process.on('unhandledRejection', e=>{
    if(e && e.code === 'ERR_MODULE_NOT_FOUND') return;
    failed = true; console.log('FAIL unhandled rejection:', (e && e.stack) || e);
  });
  process.on('exit', code=>{ if(failed && !code) process.exitCode = 1; });
  const t = setTimeout(()=>{ console.log('FAIL watchdog: suite did not finish within ' + ms/1000 + ' s'); process.exit(1); }, ms);
  t.unref();
};
