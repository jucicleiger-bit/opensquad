import "@testing-library/jest-dom/vitest";

// jsdom doesn't implement scrollIntoView — stub it so components that call
// it (e.g. scrolling an edit form into view) don't throw in tests.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
