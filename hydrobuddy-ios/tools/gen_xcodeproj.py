#!/usr/bin/env python3
"""Generates HydroBuddy.xcodeproj. Run from the hydrobuddy-ios directory:
       python3 tools/gen_xcodeproj.py
Deterministic object IDs, so regenerating produces a byte-identical project."""

import os, pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
APP = "HydroBuddy"
TESTS = "HydroBuddyTests"
BUNDLE_ID = "com.hydrobuddy.app"
DEPLOYMENT = "17.0"

_counter = [0]
def oid():
    _counter[0] += 1
    return "AB%022X" % _counter[0]

app_sources = sorted(p.name for p in (ROOT / APP).glob("*.swift"))
test_sources = sorted(p.name for p in (ROOT / TESTS).glob("*.swift"))
test_resources = sorted(p.name for p in (ROOT / TESTS).glob("*.json"))
entitlements = "HydroBuddy.entitlements"
assert app_sources and test_sources and test_resources, "missing sources"

# --- object ids -------------------------------------------------------------
ids = {
    "project": oid(), "appTarget": oid(), "testTarget": oid(),
    "appProduct": oid(), "testProduct": oid(),
    "mainGroup": oid(), "appGroup": oid(), "testGroup": oid(), "productsGroup": oid(),
    "appSources": oid(), "appFrameworks": oid(), "appResources": oid(),
    "testSources": oid(), "testFrameworks": oid(), "testResources": oid(),
    "projectConfigList": oid(), "appConfigList": oid(), "testConfigList": oid(),
    "projectDebug": oid(), "projectRelease": oid(),
    "appDebug": oid(), "appRelease": oid(), "testDebug": oid(), "testRelease": oid(),
    "dependency": oid(), "containerProxy": oid(), "entitlements": oid(),
}
file_refs, build_files = {}, {}
for name in app_sources + test_sources + test_resources:
    file_refs[name] = oid()
    build_files[name] = oid()
file_refs[entitlements] = ids["entitlements"]

def ftype(name):
    if name.endswith(".swift"): return "sourcecode.swift"
    if name.endswith(".json"): return "text.json"
    if name.endswith(".entitlements"): return "text.plist.entitlements"
    return "text"

L = []
w = L.append
w("// !$*UTF8*$!")
w("{")
w("\tarchiveVersion = 1;")
w("\tclasses = {")
w("\t};")
w("\tobjectVersion = 56;")
w("\tobjects = {")

w("\n/* Begin PBXBuildFile section */")
for name in app_sources + test_sources + test_resources:
    phase = "Sources" if name.endswith(".swift") else "Resources"
    w("\t\t%s /* %s in %s */ = {isa = PBXBuildFile; fileRef = %s /* %s */; };"
      % (build_files[name], name, phase, file_refs[name], name))
w("/* End PBXBuildFile section */")

w("\n/* Begin PBXContainerItemProxy section */")
w("\t\t%s /* PBXContainerItemProxy */ = {" % ids["containerProxy"])
w("\t\t\tisa = PBXContainerItemProxy;")
w("\t\t\tcontainerPortal = %s /* Project object */;" % ids["project"])
w("\t\t\tproxyType = 1;")
w("\t\t\tremoteGlobalIDString = %s;" % ids["appTarget"])
w("\t\t\tremoteInfo = %s;" % APP)
w("\t\t};")
w("/* End PBXContainerItemProxy section */")

w("\n/* Begin PBXFileReference section */")
w('\t\t%s /* %s.app */ = {isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = %s.app; sourceTree = BUILT_PRODUCTS_DIR; };'
  % (ids["appProduct"], APP, APP))
w('\t\t%s /* %s.xctest */ = {isa = PBXFileReference; explicitFileType = wrapper.cfbundle; includeInIndex = 0; path = %s.xctest; sourceTree = BUILT_PRODUCTS_DIR; };'
  % (ids["testProduct"], TESTS, TESTS))
for name in app_sources + [entitlements] + test_sources + test_resources:
    w('\t\t%s /* %s */ = {isa = PBXFileReference; lastKnownFileType = %s; path = %s; sourceTree = "<group>"; };'
      % (file_refs[name], name, ftype(name), name))
w("/* End PBXFileReference section */")

w("\n/* Begin PBXFrameworksBuildPhase section */")
for key in ("appFrameworks", "testFrameworks"):
    w("\t\t%s /* Frameworks */ = {" % ids[key])
    w("\t\t\tisa = PBXFrameworksBuildPhase;")
    w("\t\t\tbuildActionMask = 2147483647;")
    w("\t\t\tfiles = (")
    w("\t\t\t);")
    w("\t\t\trunOnlyForDeploymentPostprocessing = 0;")
    w("\t\t};")
w("/* End PBXFrameworksBuildPhase section */")

w("\n/* Begin PBXGroup section */")
w("\t\t%s = {" % ids["mainGroup"])
w("\t\t\tisa = PBXGroup;")
w("\t\t\tchildren = (")
w("\t\t\t\t%s /* %s */," % (ids["appGroup"], APP))
w("\t\t\t\t%s /* %s */," % (ids["testGroup"], TESTS))
w("\t\t\t\t%s /* Products */," % ids["productsGroup"])
w("\t\t\t);")
w("\t\t\tsourceTree = \"<group>\";")
w("\t\t};")

w("\t\t%s /* %s */ = {" % (ids["appGroup"], APP))
w("\t\t\tisa = PBXGroup;")
w("\t\t\tchildren = (")
for name in app_sources + [entitlements]:
    w("\t\t\t\t%s /* %s */," % (file_refs[name], name))
w("\t\t\t);")
w("\t\t\tpath = %s;" % APP)
w("\t\t\tsourceTree = \"<group>\";")
w("\t\t};")

w("\t\t%s /* %s */ = {" % (ids["testGroup"], TESTS))
w("\t\t\tisa = PBXGroup;")
w("\t\t\tchildren = (")
for name in test_sources + test_resources:
    w("\t\t\t\t%s /* %s */," % (file_refs[name], name))
w("\t\t\t);")
w("\t\t\tpath = %s;" % TESTS)
w("\t\t\tsourceTree = \"<group>\";")
w("\t\t};")

w("\t\t%s /* Products */ = {" % ids["productsGroup"])
w("\t\t\tisa = PBXGroup;")
w("\t\t\tchildren = (")
w("\t\t\t\t%s /* %s.app */," % (ids["appProduct"], APP))
w("\t\t\t\t%s /* %s.xctest */," % (ids["testProduct"], TESTS))
w("\t\t\t);")
w("\t\t\tname = Products;")
w("\t\t\tsourceTree = \"<group>\";")
w("\t\t};")
w("/* End PBXGroup section */")

w("\n/* Begin PBXNativeTarget section */")
w("\t\t%s /* %s */ = {" % (ids["appTarget"], APP))
w("\t\t\tisa = PBXNativeTarget;")
w("\t\t\tbuildConfigurationList = %s /* Build configuration list for PBXNativeTarget \"%s\" */;" % (ids["appConfigList"], APP))
w("\t\t\tbuildPhases = (")
w("\t\t\t\t%s /* Sources */," % ids["appSources"])
w("\t\t\t\t%s /* Frameworks */," % ids["appFrameworks"])
w("\t\t\t\t%s /* Resources */," % ids["appResources"])
w("\t\t\t);")
w("\t\t\tbuildRules = (")
w("\t\t\t);")
w("\t\t\tdependencies = (")
w("\t\t\t);")
w("\t\t\tname = %s;" % APP)
w("\t\t\tproductName = %s;" % APP)
w("\t\t\tproductReference = %s /* %s.app */;" % (ids["appProduct"], APP))
w("\t\t\tproductType = \"com.apple.product-type.application\";")
w("\t\t};")

w("\t\t%s /* %s */ = {" % (ids["testTarget"], TESTS))
w("\t\t\tisa = PBXNativeTarget;")
w("\t\t\tbuildConfigurationList = %s /* Build configuration list for PBXNativeTarget \"%s\" */;" % (ids["testConfigList"], TESTS))
w("\t\t\tbuildPhases = (")
w("\t\t\t\t%s /* Sources */," % ids["testSources"])
w("\t\t\t\t%s /* Frameworks */," % ids["testFrameworks"])
w("\t\t\t\t%s /* Resources */," % ids["testResources"])
w("\t\t\t);")
w("\t\t\tbuildRules = (")
w("\t\t\t);")
w("\t\t\tdependencies = (")
w("\t\t\t\t%s /* PBXTargetDependency */," % ids["dependency"])
w("\t\t\t);")
w("\t\t\tname = %s;" % TESTS)
w("\t\t\tproductName = %s;" % TESTS)
w("\t\t\tproductReference = %s /* %s.xctest */;" % (ids["testProduct"], TESTS))
w("\t\t\tproductType = \"com.apple.product-type.bundle.unit-test\";")
w("\t\t};")
w("/* End PBXNativeTarget section */")

w("\n/* Begin PBXProject section */")
w("\t\t%s /* Project object */ = {" % ids["project"])
w("\t\t\tisa = PBXProject;")
w("\t\t\tattributes = {")
w("\t\t\t\tBuildIndependentTargetsInParallel = 1;")
w("\t\t\t\tLastSwiftUpdateCheck = 1520;")
w("\t\t\t\tLastUpgradeCheck = 1520;")
w("\t\t\t\tTargetAttributes = {")
w("\t\t\t\t\t%s = {" % ids["appTarget"])
w("\t\t\t\t\t\tCreatedOnToolsVersion = 15.2;")
w("\t\t\t\t\t};")
w("\t\t\t\t\t%s = {" % ids["testTarget"])
w("\t\t\t\t\t\tCreatedOnToolsVersion = 15.2;")
w("\t\t\t\t\t\tTestTargetID = %s;" % ids["appTarget"])
w("\t\t\t\t\t};")
w("\t\t\t\t};")
w("\t\t\t};")
w("\t\t\tbuildConfigurationList = %s /* Build configuration list for PBXProject \"%s\" */;" % (ids["projectConfigList"], APP))
w("\t\t\tcompatibilityVersion = \"Xcode 14.0\";")
w("\t\t\tdevelopmentRegion = en;")
w("\t\t\thasScannedForEncodings = 0;")
w("\t\t\tknownRegions = (")
w("\t\t\t\ten,")
w("\t\t\t\tBase,")
w("\t\t\t);")
w("\t\t\tmainGroup = %s;" % ids["mainGroup"])
w("\t\t\tproductRefGroup = %s /* Products */;" % ids["productsGroup"])
w("\t\t\tprojectDirPath = \"\";")
w("\t\t\tprojectRoot = \"\";")
w("\t\t\ttargets = (")
w("\t\t\t\t%s /* %s */," % (ids["appTarget"], APP))
w("\t\t\t\t%s /* %s */," % (ids["testTarget"], TESTS))
w("\t\t\t);")
w("\t\t};")
w("/* End PBXProject section */")

w("\n/* Begin PBXResourcesBuildPhase section */")
for key, files in (("appResources", []), ("testResources", test_resources)):
    w("\t\t%s /* Resources */ = {" % ids[key])
    w("\t\t\tisa = PBXResourcesBuildPhase;")
    w("\t\t\tbuildActionMask = 2147483647;")
    w("\t\t\tfiles = (")
    for name in files:
        w("\t\t\t\t%s /* %s in Resources */," % (build_files[name], name))
    w("\t\t\t);")
    w("\t\t\trunOnlyForDeploymentPostprocessing = 0;")
    w("\t\t};")
w("/* End PBXResourcesBuildPhase section */")

w("\n/* Begin PBXSourcesBuildPhase section */")
for key, files in (("appSources", app_sources), ("testSources", test_sources)):
    w("\t\t%s /* Sources */ = {" % ids[key])
    w("\t\t\tisa = PBXSourcesBuildPhase;")
    w("\t\t\tbuildActionMask = 2147483647;")
    w("\t\t\tfiles = (")
    for name in files:
        w("\t\t\t\t%s /* %s in Sources */," % (build_files[name], name))
    w("\t\t\t);")
    w("\t\t\trunOnlyForDeploymentPostprocessing = 0;")
    w("\t\t};")
w("/* End PBXSourcesBuildPhase section */")

w("\n/* Begin PBXTargetDependency section */")
w("\t\t%s /* PBXTargetDependency */ = {" % ids["dependency"])
w("\t\t\tisa = PBXTargetDependency;")
w("\t\t\ttarget = %s /* %s */;" % (ids["appTarget"], APP))
w("\t\t\ttargetProxy = %s /* PBXContainerItemProxy */;" % ids["containerProxy"])
w("\t\t};")
w("/* End PBXTargetDependency section */")

SHARED = [
    ("ALWAYS_SEARCH_USER_PATHS", "NO"),
    ("ASSETCATALOG_COMPILER_GENERATE_SWIFT_ASSET_SYMBOL_EXTENSIONS", "YES"),
    ("CLANG_ANALYZER_NONNULL", "YES"),
    ("CLANG_ENABLE_MODULES", "YES"),
    ("CLANG_ENABLE_OBJC_ARC", "YES"),
    ("CLANG_WARN_DOCUMENTATION_COMMENTS", "YES"),
    ("CLANG_WARN_UNGUARDED_AVAILABILITY", "YES_AGGRESSIVE"),
    ("COPY_PHASE_STRIP", "NO"),
    ("ENABLE_STRICT_OBJC_MSGSEND", "YES"),
    ("GCC_NO_COMMON_BLOCKS", "YES"),
    ("GCC_WARN_UNDECLARED_SELECTOR", "YES"),
    ("GCC_WARN_UNUSED_FUNCTION", "YES"),
    ("GCC_WARN_UNUSED_VARIABLE", "YES"),
    ("IPHONEOS_DEPLOYMENT_TARGET", DEPLOYMENT),
    ("LOCALIZATION_PREFERS_STRING_CATALOGS", "YES"),
    ("MTL_FAST_MATH", "YES"),
    ("SDKROOT", "iphoneos"),
    ("SWIFT_EMIT_LOC_STRINGS", "YES"),
]
DEBUG_ONLY = [
    ("DEBUG_INFORMATION_FORMAT", "dwarf"),
    ("ENABLE_TESTABILITY", "YES"),
    ("GCC_OPTIMIZATION_LEVEL", "0"),
    ("GCC_PREPROCESSOR_DEFINITIONS", '(\n\t\t\t\t\t"DEBUG=1",\n\t\t\t\t\t"$(inherited)",\n\t\t\t\t)'),
    ("MTL_ENABLE_DEBUG_INFO", "INCLUDE_SOURCE"),
    ("ONLY_ACTIVE_ARCH", "YES"),
    ("SWIFT_ACTIVE_COMPILATION_CONDITIONS", '"DEBUG $(inherited)"'),
    ("SWIFT_OPTIMIZATION_LEVEL", "\"-Onone\""),
]
RELEASE_ONLY = [
    ("DEBUG_INFORMATION_FORMAT", '"dwarf-with-dsym"'),
    ("ENABLE_NS_ASSERTIONS", "NO"),
    ("MTL_ENABLE_DEBUG_INFO", "NO"),
    ("SWIFT_COMPILATION_MODE", "wholemodule"),
    ("VALIDATE_PRODUCT", "YES"),
]
APP_SETTINGS = [
    ("CODE_SIGN_ENTITLEMENTS", "%s/%s" % (APP, entitlements)),
    ("CODE_SIGN_STYLE", "Automatic"),
    ("CURRENT_PROJECT_VERSION", "1"),
    ("ENABLE_PREVIEWS", "YES"),
    ("GENERATE_INFOPLIST_FILE", "YES"),
    ("INFOPLIST_KEY_NSHealthShareUsageDescription",
     '"HydroBuddy+ reads nothing from Health unless you turn the Health switch on."'),
    ("INFOPLIST_KEY_NSHealthUpdateUsageDescription",
     '"HydroBuddy+ writes the drinks you log as dietary water, so Health and this app agree."'),
    ("INFOPLIST_KEY_UIApplicationSceneManifest_Generation", "YES"),
    ("INFOPLIST_KEY_UILaunchScreen_Generation", "YES"),
    ("INFOPLIST_KEY_UIStatusBarStyle", "UIStatusBarStyleLightContent"),
    ("INFOPLIST_KEY_UIUserInterfaceStyle", "Dark"),
    ("INFOPLIST_KEY_UISupportedInterfaceOrientations", '"UIInterfaceOrientationPortrait"'),
    ("MARKETING_VERSION", "1.0"),
    ("PRODUCT_BUNDLE_IDENTIFIER", BUNDLE_ID),
    ("PRODUCT_NAME", '"$(TARGET_NAME)"'),
    ("SWIFT_EMIT_LOC_STRINGS", "YES"),
    ("SWIFT_VERSION", "5.0"),
    ("TARGETED_DEVICE_FAMILY", '"1,2"'),
]
TEST_SETTINGS = [
    ("ALWAYS_EMBED_SWIFT_STANDARD_LIBRARIES", "YES"),
    ("BUNDLE_LOADER", '"$(TEST_HOST)"'),
    ("CODE_SIGN_STYLE", "Automatic"),
    ("CURRENT_PROJECT_VERSION", "1"),
    ("GENERATE_INFOPLIST_FILE", "YES"),
    ("MARKETING_VERSION", "1.0"),
    ("PRODUCT_BUNDLE_IDENTIFIER", "%s.tests" % BUNDLE_ID),
    ("PRODUCT_NAME", '"$(TARGET_NAME)"'),
    ("SWIFT_VERSION", "5.0"),
    ("TARGETED_DEVICE_FAMILY", '"1,2"'),
    ("TEST_HOST", '"$(BUILT_PRODUCTS_DIR)/%s.app/$(BUNDLE_EXECUTABLE_FOLDER_PATH)/%s"' % (APP, APP)),
]

def config(obj_id, name, settings):
    w("\t\t%s /* %s */ = {" % (obj_id, name))
    w("\t\t\tisa = XCBuildConfiguration;")
    w("\t\t\tbuildSettings = {")
    for key, value in sorted(settings):
        w("\t\t\t\t%s = %s;" % (key, value))
    w("\t\t\t};")
    w("\t\t\tname = %s;" % name)
    w("\t\t};")

w("\n/* Begin XCBuildConfiguration section */")
config(ids["projectDebug"], "Debug", SHARED + DEBUG_ONLY)
config(ids["projectRelease"], "Release", SHARED + RELEASE_ONLY)
config(ids["appDebug"], "Debug", APP_SETTINGS)
config(ids["appRelease"], "Release", APP_SETTINGS)
config(ids["testDebug"], "Debug", TEST_SETTINGS)
config(ids["testRelease"], "Release", TEST_SETTINGS)
w("/* End XCBuildConfiguration section */")

w("\n/* Begin XCConfigurationList section */")
for key, label, debug, release in (
    ("projectConfigList", 'Build configuration list for PBXProject "%s"' % APP, "projectDebug", "projectRelease"),
    ("appConfigList", 'Build configuration list for PBXNativeTarget "%s"' % APP, "appDebug", "appRelease"),
    ("testConfigList", 'Build configuration list for PBXNativeTarget "%s"' % TESTS, "testDebug", "testRelease"),
):
    w("\t\t%s /* %s */ = {" % (ids[key], label))
    w("\t\t\tisa = XCConfigurationList;")
    w("\t\t\tbuildConfigurations = (")
    w("\t\t\t\t%s /* Debug */," % ids[debug])
    w("\t\t\t\t%s /* Release */," % ids[release])
    w("\t\t\t);")
    w("\t\t\tdefaultConfigurationIsVisible = 0;")
    w("\t\t\tdefaultConfigurationName = Release;")
    w("\t\t};")
w("/* End XCConfigurationList section */")

w("\t};")
w("\trootObject = %s /* Project object */;" % ids["project"])
w("}")

proj_dir = ROOT / ("%s.xcodeproj" % APP)
(proj_dir / "xcshareddata" / "xcschemes").mkdir(parents=True, exist_ok=True)
(proj_dir / "project.pbxproj").write_text("\n".join(L) + "\n")

scheme = f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion = "1520" version = "1.7">
   <BuildAction parallelizeBuildables = "YES" buildImplicitDependencies = "YES">
      <BuildActionEntries>
         <BuildActionEntry buildForTesting = "YES" buildForRunning = "YES" buildForProfiling = "YES" buildForArchiving = "YES" buildForAnalyzing = "YES">
            <BuildableReference
               BuildableIdentifier = "primary"
               BlueprintIdentifier = "{ids['appTarget']}"
               BuildableName = "{APP}.app"
               BlueprintName = "{APP}"
               ReferencedContainer = "container:{APP}.xcodeproj">
            </BuildableReference>
         </BuildActionEntry>
      </BuildActionEntries>
   </BuildAction>
   <TestAction buildConfiguration = "Debug" selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv = "YES">
      <Testables>
         <TestableReference skipped = "NO">
            <BuildableReference
               BuildableIdentifier = "primary"
               BlueprintIdentifier = "{ids['testTarget']}"
               BuildableName = "{TESTS}.xctest"
               BlueprintName = "{TESTS}"
               ReferencedContainer = "container:{APP}.xcodeproj">
            </BuildableReference>
         </TestableReference>
      </Testables>
   </TestAction>
   <LaunchAction buildConfiguration = "Debug" selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB" launchStyle = "0" useCustomWorkingDirectory = "NO" ignoresPersistentStateOnLaunch = "NO" debugDocumentVersioning = "YES" debugServiceExtension = "internal" allowLocationSimulation = "YES">
      <BuildableProductRunnable runnableDebuggingMode = "0">
         <BuildableReference
            BuildableIdentifier = "primary"
            BlueprintIdentifier = "{ids['appTarget']}"
            BuildableName = "{APP}.app"
            BlueprintName = "{APP}"
            ReferencedContainer = "container:{APP}.xcodeproj">
         </BuildableReference>
      </BuildableProductRunnable>
   </LaunchAction>
   <ProfileAction buildConfiguration = "Release" shouldUseLaunchSchemeArgsEnv = "YES" savedToolIdentifier = "" useCustomWorkingDirectory = "NO" debugDocumentVersioning = "YES">
      <BuildableProductRunnable runnableDebuggingMode = "0">
         <BuildableReference
            BuildableIdentifier = "primary"
            BlueprintIdentifier = "{ids['appTarget']}"
            BuildableName = "{APP}.app"
            BlueprintName = "{APP}"
            ReferencedContainer = "container:{APP}.xcodeproj">
         </BuildableReference>
      </BuildableProductRunnable>
   </ProfileAction>
   <AnalyzeAction buildConfiguration = "Debug"></AnalyzeAction>
   <ArchiveAction buildConfiguration = "Release" revealArchiveInOrganizer = "YES"></ArchiveAction>
</Scheme>
'''
(proj_dir / "xcshareddata" / "xcschemes" / ("%s.xcscheme" % APP)).write_text(scheme)
print("wrote %s (%d app sources, %d test sources, %d resources)"
      % (proj_dir, len(app_sources), len(test_sources), len(test_resources)))
