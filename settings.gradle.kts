pluginManagement {
    repositories {
        // repo1 is the same Maven Central content; listed first because the main host rate-limits this environment.
        maven("https://repo1.maven.org/maven2")
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositories {
        maven("https://repo1.maven.org/maven2")
        mavenCentral()
    }
}

rootProject.name = "privatevault"
include(":core")
