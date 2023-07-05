import { useParams } from "react-router-dom";
import useAlertError from "../../../hooks/useAlertError";
import { useCallback, useEffect, useState } from "react";
import { useChartReleaseValues, useGetVersions } from "../../../API/releases";
import Modal, { ModalButtonStyle } from "../Modal";
import { GeneralDetails } from "./GeneralDetails";
import { UserDefinedValues } from "./UserDefinedValues";
import { ChartValues } from "./ChartValues";
import { ManifestDiff } from "./ManifestDiff";
import { useMutation } from "@tanstack/react-query";
import { useChartRepoValues } from "../../../API/repositories";
import useNavigateWithSearchParams from "../../../hooks/useNavigateWithSearchParams";
import { VersionToInstall } from "./VersionToInstall";

interface InstallChartModalProps {
  isOpen: boolean;
  onClose: () => void;
  chartName: string;
  chartVersion: string;
  latestVersion?: string;
  isUpgrade?: boolean;
  isInstall?: boolean;
}

export const InstallChartModal = ({
  isOpen,
  onClose,
  chartName,
  chartVersion,
  latestVersion,
  isUpgrade = false,
  isInstall = false,
}: InstallChartModalProps) => {
  const navigate = useNavigateWithSearchParams();
  const { setShowErrorModal } = useAlertError();
  const [selectedRepo, setSelectedRepo] = useState("");
  const [userValues, setUserValues] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isLoadingDiff, setIsLoadingDiff] = useState(false);
  const [diff, setDiff] = useState("");

  const {
    namespace: queryNamespace,
    chart: releaseName,
    revision,
    context: selectedCluster,
  } = useParams();
  const [namespace, setNamespace] = useState(queryNamespace);
  const [chart, setChart] = useState(chartName);

  const {
    error: versionsError,
    data: versions,
    refetch: fetchVersion,
  } = useGetVersions(chartName);

  latestVersion = latestVersion ?? chartVersion; // a guard for typescript, latestVersion is always defined
  const [selectedVersion, setSelectedVersion] = useState(
    isUpgrade ? latestVersion : chartVersion
  );

  const {
    data: chartValues,
    isLoading: loadingChartValues,
    refetch: refetchChartValues,
  } = useChartRepoValues(
    namespace || "default",
    chartName,
    selectedRepo,
    selectedVersion,
    {
      enabled: isInstall && selectedRepo !== "",
    }
  );

  const { data: releaseValues, isLoading: loadingReleaseValues } =
    useChartReleaseValues({
      namespace,
      release: String(releaseName),
      // userDefinedValue: userValues, // for key only
      revision: revision ? parseInt(revision) : undefined,
      options: {
        enabled: !isInstall,
        onSuccess: (data: string) => {
          if (data) {
            fetchDiff({ userValues: "" });
            setUserValues(data);
          }
        },
      },
    });

  useEffect(() => {
    fetchVersion();
  }, [chart, namespace]);

  useEffect(() => {
    if (versions?.length) {
      setSelectedRepo(versions[0].repository);
    }
  }, [versions]);

  useEffect(() => {
    if (selectedRepo) {
      refetchChartValues();
    }
  }, [selectedRepo, selectedVersion, namespace, chart]);

  // Confirm method (install)
  const setReleaseVersionMutation = useMutation(
    ["setVersion", namespace, chart, selectedVersion, selectedRepo],
    async () => {
      setErrorMessage("");
      const formData = new FormData();
      formData.append("preview", "false");
      formData.append("chart", `${selectedRepo}/${chartName}`);
      formData.append("version", selectedVersion);
      formData.append("values", userValues);
      formData.append("name", chart);

      const res = await fetch(
        // Todo: Change to BASE_URL from env
        `/api/helm/releases/${namespace ? namespace : "default"}${
          !isInstall ? `/${releaseName}` : `/${releaseValues ? chartName : ""}` // if there is no release we don't provide anything, and we dont display version
        }`,
        {
          method: "post",
          body: formData,
          headers: {
            "X-Kubecontext": selectedCluster as string,
          },
        }
      );

      if (!res.ok) {
        setShowErrorModal({
          title: `Failed to ${isInstall ? "install" : "upgrade"} the chart`,
          msg: String(await res.text()),
        });
      }

      return res.json();
    },
    {
      onSuccess: async (response) => {
        onClose();
        if (isInstall) {
          navigate(
            `/installed/revision/${selectedCluster}/${response.namespace}/${response.name}/1`
          );
        } else {
          setSelectedVersion(""); //cleanup
          navigate(
            `/installed/revision/${selectedCluster}/${
              namespace ? namespace : "default"
            }/${releaseName}/${response.version}`
          );
          window.location.reload();
        }
      },
      onError: (error) => {
        setErrorMessage((error as Error)?.message || "Failed to update");
      },
    }
  );

  const getVersionManifestFormData = useCallback(
    ({ version, userValues }: { version: string; userValues?: string }) => {
      const formData = new FormData();
      formData.append("chart", `${selectedRepo}/${chartName}`);
      formData.append("version", version);
      formData.append(
        "values",
        userValues ? userValues : releaseValues ? releaseValues : ""
      );
      formData.append("preview", "true");
      formData.append("name", chartName);

      return formData;
    },
    [userValues, selectedRepo, chartName]
  );

  // It actually fetches the manifest for the diffs
  const fetchVersionData = async ({
    version,
    userValues,
  }: {
    version: string;
    userValues?: string;
  }) => {
    const formData = getVersionManifestFormData({ version, userValues });
    const fetchUrl = `/api/helm/releases/${
      namespace ? namespace : isInstall ? "" : "[empty]"
    }${
      !isInstall
        ? `/${releaseName}`
        : `/${releaseValues ? chartName : "default"}`
    }`; // if there is no release we don't provide anything, and we dont display version;
    const response = await fetch(fetchUrl, {
      method: "post",
      body: formData,
    });
    const data = await response.json();
    return data;
  };

  const fetchDiff = async ({ userValues }: { userValues: string }) => {
    if (!selectedRepo || versionsError) {
      return;
    }

    const currentVersion = chartVersion;

    setIsLoadingDiff(true);
    try {
      const [currentVerData, selectedVerData] = await Promise.all([
        fetchVersionData({ version: currentVersion }),
        fetchVersionData({ version: selectedVersion, userValues }),
      ]);
      const formData = new FormData();
      if (currentVersion !== selectedVersion) {
        formData.append("a", currentVerData.manifest);
      }
      formData.append("b", selectedVerData.manifest);

      const response = await fetch("/diff", {
        method: "post",
        body: formData,
      });
      const diff = await response.text();
      setDiff(diff);
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoadingDiff(false);
    }
  };

  useEffect(() => {
    if (
      selectedVersion &&
      ((!isInstall && !loadingReleaseValues) ||
        (isInstall && !loadingChartValues)) &&
      selectedRepo
    ) {
      fetchDiff({ userValues });
    }
  }, [selectedVersion, userValues, loadingReleaseValues, selectedRepo]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        setSelectedVersion("");
        onClose();
      }}
      title={
        <div className="font-bold">
          {`${
            isUpgrade || (!isUpgrade && !isInstall) ? "Upgrade" : "Install"
          } `}
          {(isUpgrade || releaseValues || isInstall) && (
            <span className="text-green-700 ">{chartName}</span>
          )}
        </div>
      }
      containerClassNames="w-5/6 text-2xl h-2/3"
      actions={[
        {
          id: "1",
          callback: setReleaseVersionMutation.mutate,
          variant: ModalButtonStyle.info,
          isLoading: setReleaseVersionMutation.isLoading,
          disabled:
            (isInstall && loadingChartValues) ||
            (!isInstall && loadingReleaseValues) ||
            isLoadingDiff ||
            setReleaseVersionMutation.isLoading,
        },
      ]}
    >
      <VersionToInstall
        chartVersion={chartVersion}
        selectedVersion={selectedVersion}
        setSelectedVersion={setSelectedVersion}
        versions={versions ?? []}
        isInstall={isInstall}
      />
      <GeneralDetails
        releaseName={chart}
        disabled={isUpgrade || (!isUpgrade && !isInstall)}
        namespace={namespace}
        onReleaseNameInput={(releaseName) => setChart(releaseName)}
        onNamespaceInput={(namespace) => setNamespace(namespace)}
      />
      <div className="flex w-full gap-6 mt-4">
        <UserDefinedValues
          initialValue={releaseValues}
          setValues={(val) => {
            setUserValues(val);
            fetchDiff({ userValues: val });
          }}
        />

        <ChartValues
          chartValues={chartValues}
          loading={isInstall ? loadingChartValues : loadingReleaseValues}
        />
      </div>

      <ManifestDiff
        diff={diff}
        isLoading={isLoadingDiff}
        versionsError={versionsError}
      />
      {errorMessage && (
        <div>
          <p className="text-red-600 text-lg">
            Failed to get upgrade info: {errorMessage}
          </p>
        </div>
      )}
    </Modal>
  );
};
