const model = {
  resource: "Patient",
  type: "probabilistic",
  comparisons: {
    given: [name(), dictionary(["en", "es"])],
    family: [name()],
    birth_date: [date()],
    identifier: [(a, b) => a === b]
  }
};
