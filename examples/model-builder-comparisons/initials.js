const model = {
  type: "probabilistic",
  comparisons: {
    given: [
      typos(),
      dictionary(["en"]),
      (a, b) => {
        const left = Array.from(a), right = Array.from(b);
        if (left.length !== 1 && right.length !== 1) return null;
        return left[0] === right[0];
      }
    ],
    family: [typos()],
    birth_date: [typos()],
    postal_code: [typos()]
  }
};
