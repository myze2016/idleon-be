import type { RequestHandler } from "express";
import { characterState, deleteCharacter, makeWish, unlockSkill2 } from "../repositories/character.repository.js";
import { registerCharacter } from "../services/character.service.js";

export const getCharacter: RequestHandler = async (req, res) => {
  res.json({ data: await characterState(req.session.user!.id) });
};

export const postCharacter: RequestHandler = async (req, res) => {
  await registerCharacter(req.session.user!.id, req.body);
  res.status(201).json({ data: await characterState(req.session.user!.id) });
};

export const wishCharacter: RequestHandler = async (req, res) => {
  res.status(201).json({ data: await makeWish(req.session.user!.id) });
};

export const removeCharacter: RequestHandler = async (req, res) => {
  await deleteCharacter(req.session.user!.id);
  res.status(204).end();
};

export const unlockCharacterSkill: RequestHandler = async (req, res) => {
  res.json({ data: await unlockSkill2(req.session.user!.id, String(req.params.id)) });
};
