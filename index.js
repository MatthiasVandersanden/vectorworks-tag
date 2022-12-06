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

function parseServicePack(sp) {
  if (!sp.startsWith("sp")) {
    core.info("Incorrect service pack: " + sp);
    return null;
  }

  let parts = sp.split('.');
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
  
    let parts = tag.split(".");
    if (parts.length !== 3 && parts.length !== 4) {
      core.info("Incorrect tag syntax: tags have three parts: a year, sp version and a count");
      return null;
    }
  
    let year = parseInt(parts[0].substr(1, parts[0].length - 1));
    if (year < 2000 || year > 3000) {
      core.info("Incorrect year: " + year);
      return null;
    }
  
    let sp = parseServicePack(parts.length === 3 ? parts[1] : `${parts[1]}.${parts[2]}`);
    if (sp === null) {
      return null;
    }

    let count = parseInt(parts[parts.length - 1]);
    if (count < 0) {
      core.info(`Incorrect tag syntax: the counter should be positive (was ${count})`);
      return null;
    }
  
    return { year, sp, count };
  } catch (error) {
    return null;
  }
}

function compareTags(a, b) {
  if (a.year !== b.year) {
    return a.year - b.year;
  }

  if (a.sp.maj !== b.sp.maj) {
    return a.sp.maj - b.sp.maj;
  }

  if (a.sp.min !== b.sp.min) {
    return a.sp.min - b.sp.min;
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
  let sp = tag.sp.min === 0 ? `sp${tag.sp.maj}` : `sp${tag.sp.maj}.${tag.sp.min}`
  return `v${tag.year}.${sp}.${tag.count}`;
}

async function getRelevantTags(year, servicePack) {
  let sp = parseServicePack(servicePack);
  if (sp === null) {
    core.info(`Invalid service pack ${servicePack}.`)
    return [];
  }
  core.info(`Service pack: ${JSON.stringify(sp)}`);

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
  
  const relevantTags = validTags.filter((tag) => tag.year === parseInt(year) && tag.sp.maj === sp.maj && tag.sp.min === sp.min);
  core.info(`Relevant tags: ${JSON.stringify(relevantTags.map(tag => formatTag(tag)))}`);

  return relevantTags;
}

function getLatestTag(sortedTags, year, servicePack) {
  if (sortedTags.length === 0) {
    let sp = parseServicePack(servicePack);
    if (sp === null) {
      sp = { maj: 0, min: 0 };
    }

    core.info(`There is no tag with this configuration yet, creating one...`);

    return {
      year, 
      sp, 
      count: -1
    }
  }

  core.info(`Latest tag is ${JSON.stringify(sortedTags[sortedTags.length - 1])}`);

  return sortedTags[sortedTags.length - 1];
}

function getNewTag(latestTag) {
  return formatTag({
    year: latestTag.year,
    sp: latestTag.sp,
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

  const tags = await getRelevantTags(config.year, config.servicePack);
  const latestTag = getLatestTag(tags, config.year, config.servicePack);
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