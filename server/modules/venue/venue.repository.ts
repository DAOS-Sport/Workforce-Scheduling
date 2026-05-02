import { storage } from "../../storage";

export const venueRepository = {
  getAll: storage.getAllVenues.bind(storage),
  getById: storage.getVenue.bind(storage),
  getByRegion: storage.getVenuesByRegion.bind(storage),
  create: storage.createVenue.bind(storage),
  update: storage.updateVenue.bind(storage),

  // Venue requirements
  getRequirementsByRegion: storage.getVenueRequirementsByRegion.bind(storage),
  createRequirement: storage.createVenueRequirement.bind(storage),

  // Venue shift templates
  getTemplates: storage.getVenueShiftTemplates.bind(storage),
  createTemplate: storage.createVenueShiftTemplate.bind(storage),
  deleteTemplate: storage.deleteVenueShiftTemplate.bind(storage),
  deleteTemplatesByVenue: storage.deleteVenueShiftTemplatesByVenue.bind(storage),
};
