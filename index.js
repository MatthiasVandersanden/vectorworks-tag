const core = require('@actions/core');
const github = require('@actions/github');
const fs = require('fs');

let octokitSingleton = undefined;

function getConfig() {
  const path = core.getInput('path');
  core.info(`Reading config at ${path}`);

  try {
    const data = fs.readFileSync(path);
    let config = JSON.parse(data);
    core.info(`Read config: ${JSON.stringify(config)}`);

    return config;
  } catch (error) {
    core.debug(error.message);
    return null;
  }
}

function parseServicePack(sp) {
  if (!sp.startsWith("sp")) {
    core.debug("Incorrect service pack: " + sp);
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
      core.debug("Tag is undefined or empty")
      return null;
    }
  
    if (!tag.startsWith('v')) {
      core.debug("Incorrect tag syntax: tags should start with a lowercase v");
      return null;
    }
  
    let parts = tag.split(".");
    if (parts.length !== 3 && parts.length !== 4) {
      core.debug("Incorrect tag syntax: tags have three parts: a year, sp version and a count");
      return null;
    }
  
    let year = parseInt(parts[0].substr(1, parts[0].length - 1));
    if (year < 2000 || year > 3000) {
      core.debug("Incorrect year: " + year);
      return null;
    }
  
    let sp = parseServicePack(parts.length === 3 ? parts[1] : `${parts[1]}.${parts[2]}`);
    if (sp === null) {
      return null;
    }

    let count = parseInt(parts[parts.length - 1]);
    if (count < 0) {
      core.debug(`Incorrect tag syntax: the counter should be positive (was ${count})`);
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

function getOctokitSingleton() {
  if (octokitSingleton !== undefined) {
    return octokitSingleton;
  }

  const token = core.getInput('token');
  octokitSingleton = github.getOctokit(token);
  return octokitSingleton;
}

async function getAllTags(fetchedTags = [], page = 1) {
  const octokit = getOctokitSingleton();
  const repos = octokit.repos;
  core.info(JSON.stringify(octokit));
  core.info(JSON.stringify(repos));
  const tags = await repos.listTags({
    ...github.context.repo,
    per_page: 100,
    page
  });

  if (tags.data.length < 100) {
    return [...fetchedTags, ...tags.data];
  }

  return getAllTags([...fetchedTags, ...tags.data], page + 1);
}

async function getRelevantTags(year, servicePack) {
  let sp = parseServicePack(servicePack);
  if (sp === null) {
    core.debug(`Invalid service pack ${servicePack}.`)
    return [];
  }

  const tagStrings = await getAllTags();
  const tags = tagStrings.map((tag) => parseTag(tag));

  // Invalid tags
  tags.forEach((tag, index) => {
    if (tag === null) core.debug(`Found invalid tag: ${tagStrings[index]}.`);
  })

  const validTags = tags
    .filter((tag) => tag !== null)
    .sort((a, b) => compareTags(a, b));
  validTags.forEach((tag) => core.debug(`Found valid tag: ${tag}.`));
  
  const relevantTags = tags.filter((tag) => tag.year === year && tag.sp.maj === sp.maj && tag.sp.min === sp.min);
  relevantTags.forEach((tag) => core.debug(`Found relevant tag: ${tag}.`));

  return relevantTags;
}

function getLatestTag(sortedTags, year, servicePack) {
  if (sortedTags.length === 0) {
    let sp = parseServicePack(servicePack);
    if (sp === null) {
      sp = { maj: 0, min: 0 };
    }

    return {
      year, 
      sp, 
      count: -1
    }
  }

  return sortedTags[0];
}

function getNewTag(latestTag) {
  let sp = latestTag.sp.min === 0 ? `${latestTag.sp.maj}` : `${latestTag.sp.maj}.${latestTag.sp.min}`
  return `v${latestTag.year}.${sp}.${latestTag.count + 1}`;
}

async function tagCommit(GITHUB_SHA, tag) {
  const octokit = getOctokitSingleton();
  core.info(`Pushing new tag to the repo.`);
  await octokit.git.createRef({
    ...githib.context.repo,
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

  const tags = await getRelevantTags(config.year, config.sp);
  const latestTag = getLatestTag(tags, config.year, config.sp);
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