const model = {
  type: "probabilistic",
  comparisons: {
    given: [typos(), dictionary(["en"])],
    family: [typos()],
    birth_date: [typos()],
    postal_code: [typos()]
  }
};
