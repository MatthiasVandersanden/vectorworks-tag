const core = require('@actions/core');
const github = require('@actions/github');
const fs = require('fs');

const token = core.getInput("token");
const octokit = github.getOctokit(token);

function getConfig() {
  const path = core.getInput('path');
  core.info(`Reading config at ${path}`);

  try {
    const data = fs.readFileSync(path);
    let config = JSON.parse(data);
    core.info(`Read config: ${JSON.stringify(config)}`);

    return config;
  } catch (error) {
    core.info(error.message);
    return null;
  }
}

function parseUpdate(up) {
  if (!up.startsWith("up")) {
    core.info("Incorrect update: " + up);
    return null;
  }

  let parts = up.split('.');
  let maj = parseInt(parts[0].substr(2, parts[0].length - 1));
  let min = parts.length === 1 ? 0 : parseInt(parts[1]);

  return {
    maj,
    min
  };
}

function parseTag(tag) {
  try {
    if (tag === undefined || tag === null || tag.length === 0) {
      core.info("Tag is undefined or empty")
      return null;
    }
  
    if (!tag.startsWith('v')) {
      core.info("Incorrect tag syntax: tags should start with a lowercase v");
      return null;
    }
  
    let parts = tag.uplit(".");
    if (parts.length !== 3 && parts.length !== 4) {
      core.info("Incorrect tag syntax: tags have three parts: a year, up version and a count");
      return null;
    }
  
    let year = parseInt(parts[0].substr(1, parts[0].length - 1));
    if (year < 2000 || year > 3000) {
      core.info("Incorrect year: " + year);
      return null;
    }
  
    let up = parseUpdate(parts.length === 3 ? parts[1] : `${parts[1]}.${parts[2]}`);
    if (up === null) {
      return null;
    }

    let count = parseInt(parts[parts.length - 1]);
    if (count < 0) {
      core.info(`Incorrect tag syntax: the counter should be positive (was ${count})`);
      return null;
    }
  
    return { year, up, count };
  } catch (error) {
    return null;
  }
}

function compareTags(a, b) {
  if (a.year !== b.year) {
    return a.year - b.year;
  }

  if (a.up.maj !== b.up.maj) {
    return a.up.maj - b.up.maj;
  }

  if (a.up.min !== b.up.min) {
    return a.up.min - b.up.min;
  }

  if (a.count !== b.count) {
    return a.count - b.count;
  }

  return 0;
}

async function getAllTags(fetchedTags = [], page = 1) {
  const tags = await octokit.rest.repos.listTags({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    per_page: 100,
    page: page
  });

  if (tags.data.length < 100) {
    return [...fetchedTags, ...tags.data];
  }

  return getAllTags([...fetchedTags, ...tags.data], page + 1);
}

function formatTag(tag) {
  let up = `up${tag.up.maj}.${tag.up.min}`
  return `v${tag.year}.${up}.${tag.count}`;
}

async function getRelevantTags(year, update) {
  let up = parseUpdate(update);
  if (up === null) {
    core.info(`Invalid update ${update}.`)
    return [];
  }
  core.info(`Update: ${JSON.stringify(up)}`);

  const tagData = await getAllTags();
  const tags = tagData.map((tag) => parseTag(tag.name));

  // Invalid tags
  core.info(`Invalid tags: ${JSON.stringify(
    tags
    .map((tag, index) => tag === null ? tagData[index].name : null)
    .filter(tag => tag !== null)
  )}`);

  const validTags = tags
    .filter((tag) => tag !== null)
    .sort((a, b) => compareTags(a, b));
  core.info(`Valid tags: ${JSON.stringify(validTags.map(tag => formatTag(tag)))}`);
  
  const relevantTags = validTags.filter((tag) => tag.year === parseInt(year) && tag.up.maj === up.maj && tag.up.min === up.min);
  core.info(`Relevant tags: ${JSON.stringify(relevantTags.map(tag => formatTag(tag)))}`);

  return relevantTags;
}

function getLatestTag(sortedTags, year, update) {
  if (sortedTags.length === 0) {
    let up = parseUpdate(update);
    if (up === null) {
      up = { maj: 0, min: 0 };
    }

    core.info(`There is no tag with this configuration yet, creating one...`);

    return {
      year, 
      up, 
      count: -1
    }
  }

  core.info(`Latest tag is ${JSON.stringify(sortedTags[sortedTags.length - 1])}`);

  return sortedTags[sortedTags.length - 1];
}

function getNewTag(latestTag) {
  return formatTag({
    year: latestTag.year,
    up: latestTag.up,
    count: latestTag.count + 1
  });
}

async function tagCommit(GITHUB_SHA, newTag) {
  core.info(`Pushing new tag ${newTag} to the repo.`);
  await octokit.rest.git.createRef({
    ...github.context.repo,
    ref: `refs/tags/${newTag}`,
    sha: GITHUB_SHA,
  });
}

async function action() {
  const { GITHUB_REF, GITHUB_SHA } = process.env;
  
  if (!GITHUB_REF) {
    core.setFailed('Missing GITHUB_REF.');
    return;
  }
  
  if (!GITHUB_SHA) {
    core.setFailed('Missing GITHUB_SHA.');
    return;
  }
  
  const config = getConfig();
  if (config === null) {
    core.setOutput('tag', undefined);
    return;
  }
  
  core.info("Starting tagging.");

  const tags = await getRelevantTags(config.year, config.update);
  const latestTag = getLatestTag(tags, config.year, config.update);
  const newTag = getNewTag(latestTag);

  await tagCommit(GITHUB_SHA, newTag);

  core.info(`The new tag is ${newTag}.`);
  core.setOutput('tag', newTag);

  return 
}

async function run() {
  try {
    await action();
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();