const model = {
  type: "probabilistic",
  comparisons: {
    given: [typos(), dictionary(["en", "es"])],
    family: [typos()],
    birth_date: [typos()],
    identifier: [(a, b) => a === b]
  }
};
