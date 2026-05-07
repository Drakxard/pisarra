import { StudyTreeApp } from "@/components/study-tree-app";

export default function Home() {
  return (
    <StudyTreeApp
      buildInfo={{
        commitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
        deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
        environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? null,
      }}
    />
  );
}
