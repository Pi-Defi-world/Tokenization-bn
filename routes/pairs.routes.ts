import { Router } from "express";
import { deletePair, listPairs, registerPair, verifyPair } from "../controllers/pairs";

const pairRoutes = Router();

pairRoutes.post("/", registerPair);       
pairRoutes.patch("/verify", verifyPair);   
pairRoutes.get("/", listPairs);       
pairRoutes.delete("/:poolId", deletePair);  

export default pairRoutes;
