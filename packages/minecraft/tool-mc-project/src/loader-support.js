/** Loader support policy and Gradle task selection for the Minecraft profile. */
const DATAGEN_TASK_PATTERN = /(?:^|[:_-])(?:run)?data(?:gen)?(?:$|[:_-])|(?:^|[:_-])generate[a-z0-9]*data(?:$|[:_-])/iu;
/**
 * Return the profile support status for a detected loader.
 * @param loader - Detected loader.
 * @returns Profile support classification.
 */
export function loaderSupport(loader) {
    switch (loader) {
        case 'fabric':
        case 'neoforge':
            return 'supported';
        case 'architectury':
        case 'forge':
        case 'quilt':
            return 'unsupported';
        case 'unknown':
            return 'unknown';
    }
}
/**
 * Return the conventional datagen task for a loader.
 * @param loader - Detected loader.
 * @returns Conventional task name, when defined.
 */
export function preferredDatagenTask(loader) {
    switch (loader) {
        case 'architectury':
        case 'fabric':
        case 'quilt':
            return 'runDatagen';
        case 'forge':
        case 'neoforge':
            return 'runData';
        case 'unknown':
            return undefined;
    }
}
/**
 * Select declared datagen tasks while preserving explicit project evidence.
 * @param loader - Detected loader.
 * @param tasks - Declared Gradle task names.
 * @returns Unambiguous datagen task candidates.
 */
export function datagenTaskCandidates(loader, tasks) {
    const preferred = preferredDatagenTask(loader);
    const matching = tasks.filter(task => DATAGEN_TASK_PATTERN.test(task));
    if (preferred !== undefined && tasks.includes(preferred))
        return [preferred];
    if (matching.length <= 1)
        return [...matching];
    const conventional = matching.filter(task => /^(?:runData|runDatagen)$/iu.test(task));
    return conventional.length === 1 ? conventional : [...matching].sort();
}
/**
 * Build bounded validation command recommendations from detected project facts.
 * @param loader - Detected loader.
 * @param support - Loader support classification.
 * @param hasGradle - Whether root Gradle files were found.
 * @param hasWrapper - Whether a Gradle wrapper was found.
 * @param datagen - Datagen evidence collected during detection.
 * @param taskCandidates - Declared Gradle task names.
 * @returns Recommended generic and loader-specific commands.
 */
export function validationCommands(loader, support, hasGradle, hasWrapper, datagen, taskCandidates) {
    if (!hasGradle)
        return [];
    const gradle = hasWrapper ? './gradlew' : 'gradle';
    const commands = [`${gradle} build`];
    const tasks = support === 'supported' ? datagenTaskCandidates(loader, taskCandidates) : [];
    const task = datagen.length > 0 && tasks.length === 1 ? tasks[0] : undefined;
    if (task !== undefined)
        commands.push(`${gradle} ${task}`);
    return [...new Set(commands)];
}
//# sourceMappingURL=loader-support.js.map