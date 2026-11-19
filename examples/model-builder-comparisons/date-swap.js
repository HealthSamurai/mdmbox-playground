const model = {
  type: "probabilistic",
  comparisons: {
    given: [name(), dictionary(["en", "es"])],
    family: [name()],
    birth_date: [(a, b) => {
      const parse = value => {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
        if (!match) return null;
        const [year, month, day] = match.slice(1).map(Number);
        const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
        const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
          ? [year, month, day] : null;
      };
      const left = parse(a), right = parse(b);
      if (!left || !right) return null;
      return a === b || (left[0] === right[0] && left[1] === right[2] && left[2] === right[1]);
    }],
    postal_code: [identifier()]
  }
};
