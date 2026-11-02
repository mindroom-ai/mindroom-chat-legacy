const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Match a whole setting name, so PRODUCT_BUNDLE_IDENTIFIER does not match the
// end of DERIVE_MACCATALYST_PRODUCT_BUNDLE_IDENTIFIER.
const settingNamePattern = (settingName) => `(?<!\\w)${escapeRegExp(settingName)}`;

const getSection = (xcodeProject, sectionName) => {
  const begin = `/* Begin ${sectionName} section */`;
  const end = `/* End ${sectionName} section */`;
  const beginIndex = xcodeProject.indexOf(begin);
  const endIndex = xcodeProject.indexOf(end);

  if (beginIndex === -1 || endIndex === -1 || endIndex <= beginIndex) {
    throw new Error(`could not find ${sectionName} section`);
  }

  return xcodeProject.slice(beginIndex, endIndex);
};

const getObjectBlock = (xcodeProject, sectionName, objectId) => {
  const section = getSection(xcodeProject, sectionName);
  const objectPattern = new RegExp(
    `\\n\\t\\t${escapeRegExp(objectId)}(?: /\\* [^*]+ \\*/)? = \\{[\\s\\S]*?\\n\\t\\t\\};`
  );
  const match = section.match(objectPattern);

  if (!match) {
    throw new Error(`could not find ${objectId} in ${sectionName}`);
  }

  return match[0];
};

export const getAppTargetBuildConfigurationIds = (xcodeProject) => {
  const targetSection = getSection(xcodeProject, 'PBXNativeTarget');
  const targetPattern = /\n\t\t([0-9A-F]+) \/\* App \*\/ = \{[\s\S]*?\n\t\t\};/g;
  const appTargets = [...targetSection.matchAll(targetPattern)].filter((match) => {
    const block = match[0];
    return (
      block.includes('isa = PBXNativeTarget;') &&
      block.includes('name = App;') &&
      block.includes('productType = "com.apple.product-type.application";')
    );
  });

  if (appTargets.length !== 1) {
    throw new Error(`expected one App native target, found ${appTargets.length}`);
  }

  const targetBlock = appTargets[0][0];
  const buildConfigurationListId = targetBlock.match(/buildConfigurationList = ([0-9A-F]+)/)?.[1];
  if (!buildConfigurationListId) {
    throw new Error('could not find App target build configuration list');
  }

  const listBlock = getObjectBlock(xcodeProject, 'XCConfigurationList', buildConfigurationListId);
  const configurationIds = [...listBlock.matchAll(/\n\t\t\t\t([0-9A-F]+) \/\* [^*]+ \*\//g)].map(
    (match) => match[1]
  );

  if (configurationIds.length === 0) {
    throw new Error('could not find App target build configurations');
  }

  return configurationIds;
};

export const getAppTargetBuildSettingValues = (xcodeProject, settingName) =>
  getAppTargetBuildConfigurationIds(xcodeProject).map((configurationId) => {
    const configurationBlock = getObjectBlock(
      xcodeProject,
      'XCBuildConfiguration',
      configurationId
    );
    const settingPattern = new RegExp(`${settingNamePattern(settingName)} = ([^;]+);`);
    const settingValue = configurationBlock.match(settingPattern)?.[1]?.trim();

    if (!settingValue) {
      throw new Error(`missing ${settingName} in App build configuration ${configurationId}`);
    }

    return {
      configurationId,
      value: settingValue,
    };
  });

export const getSingleAppTargetBuildSettingValue = (xcodeProject, settingName) => {
  const values = getAppTargetBuildSettingValues(xcodeProject, settingName).map(
    (record) => record.value
  );
  const uniqueValues = new Set(values);

  if (uniqueValues.size !== 1) {
    throw new Error(`App target ${settingName} values must match across build configurations`);
  }

  return values[0];
};

export const replaceAppTargetBuildSetting = (xcodeProject, settingName, settingValue) => {
  let updated = xcodeProject;

  getAppTargetBuildConfigurationIds(xcodeProject).forEach((configurationId) => {
    const originalBlock = getObjectBlock(updated, 'XCBuildConfiguration', configurationId);
    const settingPattern = new RegExp(`(${settingNamePattern(settingName)} = )[^;]+;`);

    if (!settingPattern.test(originalBlock)) {
      throw new Error(`missing ${settingName} in App build configuration ${configurationId}`);
    }

    const updatedBlock = originalBlock.replace(settingPattern, `$1${settingValue};`);
    updated = updated.replace(originalBlock, updatedBlock);
  });

  return updated;
};
