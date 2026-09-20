/**
 * Prepare the selected Gradle JavaExec inputs without running its launch actions.
 * @param runtimeTask - Discovered unqualified runtime task.
 * @param destination - Project-relative operation evidence path.
 * @returns Gradle init script registering an independent preparation task.
 */
export function preparationScript(runtimeTask: string, destination: string): string {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/u.test(runtimeTask) || !/^\.dsh\/runs\/[a-f\d-]+\/preparation\.json$/u.test(destination))
    throw new Error('运行准备任务或证据路径无效。')
  return `import groovy.json.JsonOutput
gradle.beforeProject { project ->
    if (project != gradle.rootProject) return
    project.tasks.register('craftcodePrepareRun') {
        dependsOn {
            def supported = ['fabric-loom', 'net.fabricmc.fabric-loom', 'net.neoforged.moddev', 'net.neoforged.gradle.userdev'].any { project.plugins.hasPlugin(it) }
            if (!supported) throw new GradleException('Unsupported runtime preparation plugin')
            def launch = project.tasks.findByName('${runtimeTask}')
            if (!(launch instanceof JavaExec)) throw new GradleException('Runtime preparation requires a verified JavaExec task; use the runtime task directly')
            launch.taskDependencies.getDependencies(launch)
        }
        doLast {
            def launch = project.tasks.getByName('${runtimeTask}')
            def missing = launch.classpath.files.findAll { !it.exists() }
            if (!missing.empty) throw new GradleException('Missing runtime classpath: ' + missing.join(', '))
            def arguments = launch.argumentProviders.collectMany { it.asArguments().toList() }
            def jvmArguments = launch.jvmArgumentProviders.collectMany { it.asArguments().toList() }
            (arguments + jvmArguments).findAll { it.startsWith('@') && !it.startsWith('@@') }.each { value ->
                if (!project.file(value.substring(1)).isFile()) throw new GradleException('Missing runtime argument file')
            }
            // Providers can resolve generated argument files; values may contain secrets and are not persisted.
            def executable = launch.javaLauncher.orNull?.executablePath?.asFile ?: project.file(launch.executable)
            if (!executable.isFile()) throw new GradleException('Runtime Java executable is missing')
            def main = launch.mainClass.orNull
            if (!main && !launch.mainModule.orNull) throw new GradleException('Runtime main class/module is unresolved')
            def evidence = [format: 1, verified: true, task: launch.path, type: launch.class.name,
                gradle: gradle.gradleVersion, gradleUserHome: gradle.gradleUserHomeDir.absolutePath,
                gradleJava: System.getProperty('java.home'), gameJava: executable.absolutePath,
                workingDirectory: launch.workingDir.absolutePath, classpathEntries: launch.classpath.files.size(),
                argumentProviderCount: arguments.size(), jvmArgumentProviderCount: jvmArguments.size(),
                offlineLaunch: 'unverified', gameplay: 'unverified']
            def file = project.file('${destination}')
            file.parentFile.mkdirs()
            file.text = JsonOutput.toJson(evidence)
        }
    }
}
`
}
