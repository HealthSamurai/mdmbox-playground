const model = {
  type: "probabilistic",
  comparisons: {
    given: [typos(), dictionary(["en", "clinic-aliases"])],
    family: [typos()],
    birth_date: [typos()],
    postal_code: [typos()]
  }
};
