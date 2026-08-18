// vale-docker-proxy is a Windows-native stand-in for the Vale executable.
// It is launched by vale-ls and forwards Vale's arguments to Docker Desktop.
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

const containerWorkspace = "/workspace"

type config struct {
	Image     string   `json:"image"`
	Root      string   `json:"root"`
	ExtraArgs []string `json:"extraArgs"`
}

type pathMapping struct {
	host      string
	container string
}

func main() {
	var cfg config
	if err := json.Unmarshal([]byte(os.Getenv("VALE_DOCKER_PROXY_CONFIG")), &cfg); err != nil {
		fatal("invalid VALE_DOCKER_PROXY_CONFIG: %v", err)
	}
	if cfg.Image == "" || cfg.Root == "" {
		fatal("VALE_DOCKER_PROXY_CONFIG must specify image and root")
	}

	mappings := []pathMapping{{host: filepath.Clean(cfg.Root), container: containerWorkspace}}
	valeArgs := make([]string, 0, len(os.Args)-1)
	dockerArgs := []string{"run", "--rm", "-i", "--mount", bindMount(cfg.Root, containerWorkspace), "-w", containerWorkspace}
	dockerArgs = append(dockerArgs, cfg.ExtraArgs...)

	for _, arg := range os.Args[1:] {
		translated, mapping := translateArgument(arg, mappings, len(mappings))
		if mapping != nil {
			mappings = append(mappings, *mapping)
			dockerArgs = append(dockerArgs, "--mount", bindMount(mapping.host, mapping.container))
		}
		valeArgs = append(valeArgs, translated)
	}

	dockerArgs = append(dockerArgs, cfg.Image)
	dockerArgs = append(dockerArgs, valeArgs...)
	cmd := exec.Command("docker.exe", dockerArgs...)
	cmd.Stdin = os.Stdin
	cmd.Stderr = os.Stderr
	out, err := cmd.Output()
	if len(out) > 0 {
		_, _ = os.Stdout.Write(translateJSONOutput(out, mappings))
	}
	if err == nil {
		return
	}
	if exitError, ok := err.(*exec.ExitError); ok {
		os.Exit(exitError.ExitCode())
	}
	fatal("failed to run docker.exe: %v", err)
}

func translateArgument(arg string, mappings []pathMapping, mappingIndex int) (string, *pathMapping) {
	prefix := ""
	value := arg
	if strings.HasPrefix(arg, "--config=") {
		prefix = "--config="
		value = strings.TrimPrefix(arg, prefix)
	}

	for _, mapping := range mappings {
		if translated, ok := replaceWindowsPrefix(value, mapping.host, mapping.container); ok {
			return prefix + translated, nil
		}
	}

	if filepath.IsAbs(value) {
		hostDir := filepath.Dir(value)
		containerDir := fmt.Sprintf("/vale-host/%d", mappingIndex)
		mapping := pathMapping{host: hostDir, container: containerDir}
		return prefix + containerDir + "/" + filepath.Base(value), &mapping
	}
	return arg, nil
}

func replaceWindowsPrefix(value, hostRoot, containerRoot string) (string, bool) {
	cleanValue := filepath.Clean(value)
	relative, err := filepath.Rel(hostRoot, cleanValue)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", false
	}
	if relative == "." {
		return containerRoot, true
	}
	return containerRoot + "/" + filepath.ToSlash(relative), true
}

func bindMount(host, container string) string {
	return fmt.Sprintf("type=bind,source=%s,target=%s", host, container)
}

func translateJSONOutput(output []byte, mappings []pathMapping) []byte {
	var value any
	if json.Unmarshal(output, &value) != nil {
		return output
	}
	value = translateJSONValue(value, mappings)
	translated, err := json.Marshal(value)
	if err != nil {
		return output
	}
	return append(translated, '\n')
}

func translateJSONValue(value any, mappings []pathMapping) any {
	switch typed := value.(type) {
	case string:
		for _, mapping := range mappings {
			if typed == mapping.container || strings.HasPrefix(typed, mapping.container+"/") {
				relative := strings.TrimPrefix(typed, mapping.container)
				return filepath.Clean(mapping.host + filepath.FromSlash(relative))
			}
		}
		return typed
	case []any:
		for index := range typed {
			typed[index] = translateJSONValue(typed[index], mappings)
		}
	case map[string]any:
		translated := make(map[string]any, len(typed))
		for key, item := range typed {
			newKey := translateJSONValue(key, mappings).(string)
			translated[newKey] = translateJSONValue(item, mappings)
		}
		return translated
	}
	return value
}

func fatal(format string, args ...any) {
	_, _ = fmt.Fprintf(os.Stderr, "vale-docker-proxy: "+format+"\n", args...)
	os.Exit(1)
}
