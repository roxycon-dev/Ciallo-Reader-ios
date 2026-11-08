plugins {
    kotlin("jvm") version "2.0.21"
    application
}

group = "parity"
version = "1.0.0"

repositories {
    mavenCentral()
}

dependencies {
    implementation(kotlin("stdlib"))
}

kotlin {
    jvmToolchain(17)
}

application {
    mainClass.set("parity.ExporterKt")
}

tasks.test {
    useJUnitPlatform()
}
