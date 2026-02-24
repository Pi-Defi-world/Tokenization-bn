import { Router } from "express";
import { deletePair, listPairs, registerPair, verifyPair } from "../controllers/pairs";
import { isAuthenticated } from "../middlewares/isAuthenticated";
import { isAdmin } from "../middlewares/isAdmin";

const pairRoutes = Router();

pairRoutes.post("/", registerPair);       
pairRoutes.patch("/verify", verifyPair);   
pairRoutes.get("/", listPairs);       
pairRoutes.delete("/:poolId", isAuthenticated, isAdmin, deletePair);  

export default pairRoutes;
