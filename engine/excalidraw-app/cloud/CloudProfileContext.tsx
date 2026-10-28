import { createContext, useContext } from "react";

export const CloudProfileContext = createContext<string | null>(null);

export const useCloudProfileUsername = () => useContext(CloudProfileContext);
