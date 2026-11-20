const model = {
  resource: "Patient",
  type: "probabilistic",
  comparisons: {
    given: [
      name(),
      dictionary(["en"]),
      (a, b) => {
        const left = Array.from(a), right = Array.from(b);
        if (left.length !== 1 && right.length !== 1) return null;
        return left[0] === right[0];
      }
    ],
    family: [name()],
    birth_date: [date()],
    postal_code: [identifier()]
  }
};
