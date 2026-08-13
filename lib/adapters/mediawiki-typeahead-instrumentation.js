const listeners = Object.freeze({
  onFetchEnd: () => {},
  onSuggestionClick: () => {},
  onSubmit: () => {}
});

export default Object.freeze({
  listeners,
  getWprovFromResultIndex: () => '',
  addWprovToSearchResultUrls: (results) => results
});
