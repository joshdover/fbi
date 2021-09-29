/* eslint-disable @typescript-eslint/no-var-requires */
require("@babel/register");
const fetch = require("node-fetch");
const fs = require("fs/promises");
const path = require("path");
const tar = require("tar");
const { pipeline } = require("stream");
const { promisify } = require("util");

const pipe = promisify(pipeline);

const AGENT_DIR = path.join(__dirname, "..", "elastic_agent");

const createDirIfNeeded = async (path) => {
  const dirExists = await fs
    .access(path)
    .then(() => true)
    .catch(() => false);
  if (!dirExists) {
    await fs.mkdir(path);
  }
};

const downloadElasticAgent = async () => {
  await createDirIfNeeded(AGENT_DIR);

  console.log("Fetching latest 8.0.0-SNAPSHOT of elastic-agent");
  const artifactsResponse = await fetch(
    `https://artifacts-api.elastic.co/v1/branches/master/builds/latest`
  );
  const artifactsBody = await artifactsResponse.json();
  const latestSnapshotTarballUrl =
    artifactsBody.build.projects.beats.packages[
      "elastic-agent-8.0.0-SNAPSHOT-linux-x86_64.tar.gz"
    ].url;
  console.log(
    `Downloading and extracting ${latestSnapshotTarballUrl} into ${AGENT_DIR}`
  );

  const tarballResponse = await fetch(latestSnapshotTarballUrl);
  const readStream = tarballResponse.body;
  const writeStream = tar.x({
    C: path.join(AGENT_DIR),
  });

  await pipe(readStream, writeStream);
  console.log(`Elastic Agent extracted`);
};

downloadElasticAgent();
