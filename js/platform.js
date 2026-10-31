/* Platform shim.
   The app was first built as a Claude artifact, where `window.claude` provides two capabilities:
     claude.use('downloads') -> { save({filename, data}) }   save a file for the user
     claude.use('sample')    -> async (prompt, opts) => { text }   ask Claude to write text
   When the page runs anywhere else (VS Code Live Server, your own hosting) this shim supplies
   the same interface using normal browser features:
     - downloads: a regular browser file download
     - sample (AI): disabled unless you define window.SURVEY_AI (see ai-config.js)
   Inside claude.ai the real window.claude already exists and this file does nothing. */
(function () {
  if (window.claude && typeof window.claude.use === 'function') return;

  const downloads = {
    async save({ filename, data }) {
      const type = /\.md$/i.test(filename) ? 'text/markdown;charset=utf-8' : '';
      const blob = data instanceof Blob ? data : new Blob([data], type ? { type } : undefined);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.append(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 1500);
    },
  };

  window.claude = {
    use: async (name) =>
      name === 'downloads' ? downloads : name === 'sample' ? window.SURVEY_AI || null : null,
  };
})();
