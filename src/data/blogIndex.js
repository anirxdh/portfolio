// /blog/index.json (written by scripts/build-blog.mjs): the list of published write-ups.
// The homepage reads it in three places (the story sky and universe, the Writing section and the
// command palette), so they share one request per page view. A failed request is forgotten, so the
// next caller tries again; callers that only decorate catch and use an empty list.
let pending = null;

export function loadBlogIndex() {
  if (!pending) {
    pending = fetch('/blog/index.json')
      .then((r) => {
        if (!r.ok) throw new Error(`index.json ${r.status}`);
        return r.json();
      })
      .then((list) => (Array.isArray(list) ? list : []))
      .catch((err) => {
        pending = null;
        throw err;
      });
  }
  return pending;
}
