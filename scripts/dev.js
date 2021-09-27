require("@babel/register")({
  extensions: ['.js', '.ts', '.tsx']
});

const { cli } = require("../src/index.js");
cli();
