const model = {
  resource: "Patient",
  type: "probabilistic",
  comparisons: {
    given: [name(), dictionary(["en"])],
    family: [name()],
    birth_date: [date()],
    postal_code: [identifier()]
  }
};
