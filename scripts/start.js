/* eslint-disable @typescript-eslint/no-var-requires */
require("@babel/register")({
  extensions: [".js", ".ts", ".tsx"],
});

const { cli } = require("../src");
cli();
